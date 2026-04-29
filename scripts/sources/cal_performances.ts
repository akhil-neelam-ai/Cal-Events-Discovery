/**
 * Cal Performances adapter — arts events from calperformances.org.
 *
 * Cal Performances is UC Berkeley's professional performing arts presenter,
 * hosting concerts, dance, theatre, and family events at Zellerbach Hall,
 * Hearst Greek Theatre, and other campus venues.
 *
 * No iCal feed exists. Instead we use the WordPress REST API
 * (calperformances.org/wp-json/wp/v2/cp_event) which exposes every
 * performance as a custom post type. Each post's `content.rendered` HTML
 * contains structured `addeventatc` spans (start, end, timezone, title)
 * and an `event-location-block` element, so we parse those rather than
 * hitting individual event pages.
 *
 * Feed: https://calperformances.org/wp-json/wp/v2/cp_event
 * Pages: up to 4 (100 per page, ~327 total posts)
 */

import * as cheerio from "cheerio";
import { signalWithTimeout, type FetchOptions } from "../lib/abort.js";
import type { CanonicalEvent } from "../lib/schema.js";
import { CanonicalEventSchema } from "../lib/schema.js";

const WP_API_BASE = "https://calperformances.org/wp-json/wp/v2/cp_event";
const PER_PAGE = 100;
const FETCH_TIMEOUT_MS = 30_000;
const SOURCE_URL = "https://calperformances.org/events/";

export interface FetchResult {
  events: CanonicalEvent[];
  rawCount: number;
  filteredPast: number;
  invalid: number;
}

interface WpCpEvent {
  id: number;
  slug: string;
  link: string;
  title: { rendered: string };
  content: { rendered: string };
}

function todayPT(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#038;/g, "&")
    .replace(/&#8217;/g, "\u2019")
    .replace(/&#8220;/g, "\u201c")
    .replace(/&#8221;/g, "\u201d")
    .replace(/&#160;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse "MM/DD/YYYY HH:MM am/pm" (the addeventatc format) into an ISO 8601
 * string anchored to America/Los_Angeles. Returns null if unparseable.
 *
 * Example input: "04/17/2026 05:30 pm"
 */
export function parseAddeventatcDate(raw: string): string | null {
  const m = raw
    .trim()
    .match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (!m) return null;
  const [, mon, day, year, hrRaw, min, ampm] = m;
  let hr = parseInt(hrRaw, 10);
  if (ampm.toLowerCase() === "pm" && hr !== 12) hr += 12;
  if (ampm.toLowerCase() === "am" && hr === 12) hr = 0;

  // Build a date string in PT and format as ISO with offset.
  // We use Intl to detect the UTC offset for that instant in PT.
  const candidate = new Date(
    `${year}-${mon.padStart(2, "0")}-${day.padStart(2, "0")}T${String(hr).padStart(2, "0")}:${min}:00`,
  );
  if (isNaN(candidate.getTime())) return null;

  // Determine UTC offset for America/Los_Angeles at this date and emit
  // an ISO string tagged with the PT offset.
  const isDST = isDaylightSavingTime(candidate, "America/Los_Angeles");
  const offsetMin = isDST ? -7 * 60 : -8 * 60;
  const offsetSign = offsetMin < 0 ? "-" : "+";
  const absOffset = Math.abs(offsetMin);
  const offsetStr = `${offsetSign}${String(Math.floor(absOffset / 60)).padStart(2, "0")}:${String(absOffset % 60).padStart(2, "0")}`;

  const yyyy = year;
  const mm = mon.padStart(2, "0");
  const dd = day.padStart(2, "0");
  const HH = String(hr).padStart(2, "0");
  const MM = min.padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${HH}:${MM}:00${offsetStr}`;
}

function isDaylightSavingTime(date: Date, tz: string): boolean {
  // Compare a known standard-time date in January against the tested date.
  const jan = new Date(date.getFullYear(), 0, 15);
  const getOffset = (d: Date): number => {
    const utcHour = d.getUTCHours();
    const ptHour = parseInt(
      new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hour: "numeric",
        hour12: false,
      }).format(d),
      10,
    );
    return utcHour - ptHour;
  };
  const stdOffset = getOffset(jan); // should be 8
  const testOffset = getOffset(date);
  return testOffset < stdOffset; // if offset is smaller (e.g. 7), it's DST
}

/**
 * Extract structured event data from a cp_event post's content HTML.
 * Returns null if no addeventatc start span is found.
 */
function extractFromContent(contentHtml: string): {
  start: string;
  end: string | undefined;
  venue: string;
  description: string;
  cost: string;
} | null {
  const $ = cheerio.load(contentHtml);

  const startRaw = $("span.start").first().text().trim();
  if (!startRaw) return null;

  const endRaw = $("span.end").first().text().trim();
  const venue = decodeHtmlEntities($("a.event-location").first().text().trim());
  const costRaw = $(".event-price-block").first().text().trim();
  const cost = decodeHtmlEntities(costRaw);

  // Pull the first substantive text block for description — skip boilerplate
  const BOILERPLATE =
    /service charge|ticket office|subscription|tax.deductible|order online/i;
  let description = "";
  $(".fusion-text p").each((_, el) => {
    const t = $(el).text().trim();
    if (t.length > 30 && !BOILERPLATE.test(t) && !description) {
      description = decodeHtmlEntities(t.replace(/\s+/g, " "));
    }
  });

  const start = parseAddeventatcDate(startRaw);
  if (!start) return null;

  const end = endRaw ? (parseAddeventatcDate(endRaw) ?? undefined) : undefined;

  return { start, end, venue, description, cost };
}

async function fetchPage(
  page: number,
  options: FetchOptions,
): Promise<WpCpEvent[]> {
  const url = `${WP_API_BASE}?per_page=${PER_PAGE}&page=${page}&_fields=id,slug,link,title,content`;
  const res = await fetch(url, {
    signal: signalWithTimeout(options.signal, FETCH_TIMEOUT_MS),
    headers: { "User-Agent": "Cal-Events-Discovery-Bot" },
  });
  if (!res.ok) {
    if (res.status === 400) return []; // page out of range
    throw new Error(
      `WP API fetch failed: ${res.status} ${res.statusText} (page ${page})`,
    );
  }
  return (await res.json()) as WpCpEvent[];
}

export async function fetchCalPerformances(
  options: FetchOptions = {},
): Promise<FetchResult> {
  console.log("[cal_performances] fetching WP REST API (cp_event)");

  const todayIso = todayPT();
  const fetched_at = new Date().toISOString();
  const events: CanonicalEvent[] = [];
  let rawCount = 0;
  let filteredPast = 0;
  let invalid = 0;

  // Fetch all pages in parallel (typically 4)
  // We don't know the total pages ahead of time, so fetch until empty.
  const firstPage = await fetchPage(1, options);
  const allPosts: WpCpEvent[] = [...firstPage];

  if (firstPage.length === PER_PAGE) {
    // Fetch remaining pages
    const remainingPages: Promise<WpCpEvent[]>[] = [];
    for (let p = 2; p <= 10; p++) {
      remainingPages.push(fetchPage(p, options));
    }
    const settled = await Promise.all(remainingPages);
    for (const page of settled) {
      allPosts.push(...page);
      if (page.length < PER_PAGE) break;
    }
  }

  console.log(
    `[cal_performances] fetched ${allPosts.length} posts from WP API`,
  );

  for (const post of allPosts) {
    rawCount++;
    try {
      const title = decodeHtmlEntities(post.title?.rendered ?? "");
      if (!title) {
        invalid++;
        continue;
      }

      const parsed = extractFromContent(post.content?.rendered ?? "");
      if (!parsed) {
        // No addeventatc date — skip (likely a non-performance post or past event stripped)
        invalid++;
        continue;
      }

      const { start, end, venue, description, cost } = parsed;

      // Filter past events (compare date portion in PT)
      const eventDate = start.slice(0, 10);
      if (eventDate < todayIso) {
        filteredPast++;
        continue;
      }

      // Infer a sub-genre tag from the URL path segment
      const urlSegments = (post.link ?? "").split("/").filter(Boolean);
      const genreSlug =
        urlSegments.length >= 4 ? urlSegments[urlSegments.length - 2] : "";
      const genre = genreSlug
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());

      const candidate: CanonicalEvent = {
        source_name: "cal_performances",
        source_id: String(post.id),
        source_url: SOURCE_URL,
        evidence_url: post.link,
        title,
        description: description || title,
        start_at: start,
        end_at: end,
        timezone: "America/Los_Angeles",
        all_day: false,
        venue: venue || "Cal Performances",
        building: "",
        address: "",
        modality: "in_person",
        organizer: "Cal Performances",
        organizer_unit: "Cal Performances",
        audience: "",
        cost,
        registration_url: post.link as string,
        canonical_url: post.link,
        categories: ["Arts"],
        tags: ["Arts", ...(genre ? [genre] : [])],
        last_seen_at: fetched_at,
        confidence: 0.95,
        quality_flags: [],
      };

      const validated = CanonicalEventSchema.safeParse(candidate);
      if (!validated.success) {
        invalid++;
        if (invalid <= 5) {
          console.warn(
            `[cal_performances] schema reject "${title}": ` +
              validated.error.issues
                .map((i) => `${i.path.join(".")}:${i.message}`)
                .join("; "),
          );
        }
        continue;
      }
      events.push(validated.data);
    } catch (err) {
      invalid++;
      if (invalid <= 5) {
        console.warn(
          `[cal_performances] failed to parse post ${post.id}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  console.log(
    `[cal_performances] parsed ${events.length}/${rawCount} (past: ${filteredPast}, invalid: ${invalid})`,
  );
  return { events, rawCount, filteredPast, invalid };
}
