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
import type { FetchOptions } from "../lib/abort.js";
import { fetchWithRetry } from "../lib/fetchWithRetry.js";
import type { CanonicalEvent, FetchResult } from "../lib/schema.js";
import { CanonicalEventSchema } from "../lib/schema.js";
import { endedBeforePT, isoDateInPT, todayPT } from "../lib/normalize.js";

const WP_API_BASE = "https://calperformances.org/wp-json/wp/v2/cp_event";
const PER_PAGE = 100;
const MAX_PAGES = 10;
const FETCH_TIMEOUT_MS = 30_000;
const SOURCE_URL = "https://calperformances.org/events/";

interface WpCpEvent {
  id: number;
  slug: string;
  link: string;
  title: { rendered: string };
  content: { rendered: string };
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

function ptOffsetFor(year: number, month: number, day: number): string {
  const probe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    timeZoneName: "longOffset",
  }).formatToParts(probe);
  const tz = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  const match = tz.match(/GMT([+-])(\d{2}):(\d{2})/);
  return match ? `${match[1]}${match[2]}:${match[3]}` : "-08:00";
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

  const monthNum = Number(mon);
  const dayNum = Number(day);
  const yearNum = Number(year);
  const probe = new Date(Date.UTC(yearNum, monthNum - 1, dayNum, 12, 0, 0));
  if (
    probe.getUTCFullYear() !== yearNum ||
    probe.getUTCMonth() !== monthNum - 1 ||
    probe.getUTCDate() !== dayNum
  ) {
    return null;
  }

  const yyyy = year;
  const mm = mon.padStart(2, "0");
  const dd = day.padStart(2, "0");
  const HH = String(hr).padStart(2, "0");
  const MM = min.padStart(2, "0");
  const offsetStr = ptOffsetFor(yearNum, monthNum, dayNum);
  return `${yyyy}-${mm}-${dd}T${HH}:${MM}:00${offsetStr}`;
}

interface Performance {
  start: string;
  end: string | undefined;
}

/**
 * Extract structured event data from a cp_event post's content HTML.
 * A production can carry one addeventatc widget per performance, so every
 * `span.start` is read with the `span.end` beside it. Returns null if no
 * performance parses.
 */
function extractFromContent(contentHtml: string): {
  performances: Performance[];
  venue: string;
  description: string;
  cost: string;
} | null {
  const $ = cheerio.load(contentHtml);

  const performances: Performance[] = [];
  $("span.start").each((_, el) => {
    const start = parseAddeventatcDate($(el).text().trim());
    if (!start) return;
    const endRaw = $(el).siblings("span.end").first().text().trim();
    const end = endRaw
      ? (parseAddeventatcDate(endRaw) ?? undefined)
      : undefined;
    performances.push({ start, end });
  });
  if (performances.length === 0) return null;

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

  return { performances, venue, description, cost };
}

interface WpPage {
  posts: WpCpEvent[];
  /** WordPress's X-WP-TotalPages header, when the response carries it. */
  totalPages?: number;
}

async function fetchPage(page: number, options: FetchOptions): Promise<WpPage> {
  const url = `${WP_API_BASE}?per_page=${PER_PAGE}&page=${page}&_fields=id,slug,link,title,content`;
  const res = await fetchWithRetry(
    url,
    {
      headers: { "User-Agent": "Cal-Events-Discovery-Bot" },
    },
    {
      signal: options.signal,
      timeoutMs: FETCH_TIMEOUT_MS,
      label: "cal_performances",
      acceptStatuses: [400],
    },
  );
  if (res.status === 400) return { posts: [] }; // page out of range
  const totalPages = Number(res.headers.get("X-WP-TotalPages"));
  return {
    posts: (await res.json()) as WpCpEvent[],
    totalPages:
      Number.isInteger(totalPages) && totalPages > 0 ? totalPages : undefined,
  };
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

  // Page 1 reports the page count, so the rest download in parallel. Four
  // sequential pages took 24 to 31 s against a 60 s adapter budget. Without
  // the header, page on until WordPress returns a short page.
  const first = await fetchPage(1, options);
  const allPosts: WpCpEvent[] = [...first.posts];
  if (first.totalPages !== undefined) {
    const rest = await Promise.all(
      Array.from(
        { length: Math.min(first.totalPages, MAX_PAGES) - 1 },
        (_, index) => fetchPage(index + 2, options),
      ),
    );
    for (const page of rest) allPosts.push(...page.posts);
  } else if (first.posts.length === PER_PAGE) {
    for (let pageNumber = 2; pageNumber <= MAX_PAGES; pageNumber += 1) {
      const page = await fetchPage(pageNumber, options);
      allPosts.push(...page.posts);
      if (page.posts.length < PER_PAGE) break;
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

      const { venue, description, cost } = parsed;

      // Keep the performances that have not ended. A run publishes as one
      // event across its remaining days, so it stays listed after opening
      // night.
      const upcoming = parsed.performances
        .filter(
          (show) =>
            !endedBeforePT(
              { start_at: show.start, end_at: show.end, all_day: false },
              todayIso,
            ),
        )
        .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
      if (upcoming.length === 0) {
        filteredPast++;
        continue;
      }
      const first = upcoming[0];
      const last = upcoming[upcoming.length - 1];
      const days = [
        ...new Set(upcoming.map((show) => isoDateInPT(show.start))),
      ];
      const run = days.length > 1;

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
        start_at: first.start,
        end_at: run ? (last.end ?? last.start) : first.end,
        occurrence_dates: run ? days : undefined,
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
