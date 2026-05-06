/**
 * BAMPFA HTML scraper — Berkeley Art Museum & Pacific Film Archive.
 *
 * bampfa.org publishes no iCal or RSS feed. The Drupal-based calendar at
 * /visit/calendar (and /visit/calendar/YYYY-MM for future months) embeds a
 * Google Calendar "Add to Calendar" link for every event. Those links carry
 * machine-readable dates (YYYYMMDDTHHMMSS), the event title, a description,
 * and a canonical bampfa.org event URL — enough to build CanonicalEvent
 * without page-by-page scraping of individual event detail pages.
 *
 * We fetch the current month plus the next 3 months (4 requests total),
 * deduplicate by event URL (multi-day recurring events appear once per
 * occurrence), and emit one CanonicalEvent per occurrence.
 *
 * Discovery: bampfa.org DOES push a subset of events to events.berkeley.edu
 * (LiveWhale), but only ~9 events appear there vs. 64+ on bampfa.org itself.
 * This adapter covers the gap.
 */

import * as cheerio from "cheerio";
import {
  abortableDelay,
  signalWithTimeout,
  throwIfAborted,
  type FetchOptions,
} from "../lib/abort.js";
import type { CanonicalEvent } from "../lib/schema.js";
import { CanonicalEventSchema } from "../lib/schema.js";

const BASE_URL = "https://bampfa.org";
const CALENDAR_URL = `${BASE_URL}/visit/calendar`;
const FETCH_TIMEOUT_MS = 12_000;
const MAX_FETCH_ATTEMPTS = 2;
const RETRY_DELAY_MS = 1_500;
/** Fetch the current month plus this many future months. */
const MONTHS_AHEAD = 3;
const PT_TIME_ZONE = "America/Los_Angeles";
const PT_OFFSET_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: PT_TIME_ZONE,
  timeZoneName: "longOffset",
});
const PT_WALL_TIME_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: PT_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export interface FetchResult {
  events: CanonicalEvent[];
  rawCount: number;
  filteredPast: number;
  invalid: number;
}

function todayPT(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function ptOffsetForInstant(instant: Date): string {
  const parts = PT_OFFSET_FORMATTER.formatToParts(instant);
  const tz = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  const match = tz.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  return match
    ? `${match[1]}${pad2(Number(match[2]))}:${match[3] ?? "00"}`
    : "-08:00";
}

function ptWallTimeParts(instant: Date): Record<string, string> {
  return Object.fromEntries(
    PT_WALL_TIME_FORMATTER.formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

/**
 * Compute the Pacific-time UTC offset (e.g. "-07:00" PDT, "-08:00" PST) for a
 * given local calendar moment. Candidate offsets are round-tripped through
 * Intl so transition days use the offset in effect at the event's wall time.
 */
function ptOffsetFor(
  year: number,
  month: number,
  day: number,
  hour = 12,
  minute = 0,
  second = 0,
): string {
  const target = {
    year: String(year),
    month: pad2(month),
    day: pad2(day),
    hour: pad2(hour),
    minute: pad2(minute),
    second: pad2(second),
  };
  const localIso = `${target.year}-${target.month}-${target.day}T${target.hour}:${target.minute}:${target.second}`;

  for (const candidateOffset of ["-08:00", "-07:00"]) {
    const candidate = new Date(`${localIso}${candidateOffset}`);
    if (Number.isNaN(candidate.getTime())) continue;

    const parts = ptWallTimeParts(candidate);
    if (
      parts.year === target.year &&
      parts.month === target.month &&
      parts.day === target.day &&
      parts.hour === target.hour &&
      parts.minute === target.minute &&
      parts.second === target.second
    ) {
      return ptOffsetForInstant(candidate);
    }
  }

  return ptOffsetForInstant(new Date(Date.UTC(year, month - 1, day, 12, 0, 0)));
}

/**
 * Convert the compact Google Calendar date token (YYYYMMDDTHHMMSS or
 * YYYYMMDD) to an ISO-8601 string suitable for CanonicalEvent.start_at.
 *
 * BAMPFA's GCal links carry naive Pacific-time tokens with no offset. We
 * append an explicit PT offset so downstream consumers (and `new Date(...)`
 * on UTC CI runners) interpret the moment correctly.
 */
export function gcalTokenToIso(token: string): {
  iso: string;
  allDay: boolean;
} {
  // All-day: YYYYMMDD (8 chars, no T)
  if (!token.includes("T")) {
    const year = token.slice(0, 4);
    const month = token.slice(4, 6);
    const day = token.slice(6, 8);
    return { iso: `${year}-${month}-${day}`, allDay: true };
  }
  // Date-time: YYYYMMDDTHHMMSS
  const year = token.slice(0, 4);
  const month = token.slice(4, 6);
  const day = token.slice(6, 8);
  const hour = token.slice(9, 11);
  const min = token.slice(11, 13);
  const sec = token.slice(13, 15) || "00";
  const offset = ptOffsetFor(
    Number(year),
    Number(month),
    Number(day),
    Number(hour),
    Number(min),
    Number(sec),
  );
  return {
    iso: `${year}-${month}-${day}T${hour}:${min}:${sec}${offset}`,
    allDay: false,
  };
}

/**
 * Parse Google Calendar "Add to Calendar" URLs embedded in the BAMPFA
 * calendar page. Each URL encodes text (title), dates (start/end), details
 * (description + bampfa.org event URL), and location.
 *
 * Example:
 *   https://calendar.google.com/calendar/r/eventedit?text=Film+Title&
 *   dates=20260422T190000/20260422T210000&details=...&location=BAMPFA
 */
export interface ParsedGCalLink {
  title: string;
  startToken: string;
  endToken: string | undefined;
  canonicalUrl: string;
  description: string;
  location: string;
}

export function parseGCalLink(href: string): ParsedGCalLink | null {
  try {
    // The href may be HTML-entity-encoded (& → &amp;) — cheerio already
    // decodes .attr() values, but guard against raw strings.
    const url = new URL(href.replace(/&amp;/g, "&"));
    const text = url.searchParams.get("text") ?? "";
    const dates = url.searchParams.get("dates") ?? "";
    const details = url.searchParams.get("details") ?? "";
    const location = url.searchParams.get("location") ?? "BAMPFA";

    if (!text || !dates) return null;

    const [startToken, endToken] = dates.split("/");

    // Extract canonical bampfa.org URL from the details string.
    // BAMPFA embeds it at the end: "... event details: https://bampfa.org/event/slug"
    const urlMatch = details.match(/https:\/\/bampfa\.org\/event\/\S+/);
    const canonicalUrl = urlMatch ? urlMatch[0].trimEnd() : "";
    if (!canonicalUrl) return null;

    // Strip the boilerplate preamble from the description.
    const descPreamble =
      /Please note that event details are subject to change[^:]*:\s*/i;
    const cleanDesc = details
      .replace(descPreamble, "")
      .replace(urlMatch?.[0] ?? "", "")
      .trim();

    return {
      title: text.trim(),
      startToken,
      endToken: endToken && endToken !== startToken ? endToken : undefined,
      canonicalUrl,
      description: cleanDesc || text.trim(),
      location: location.trim(),
    };
  } catch {
    return null;
  }
}

async function fetchCalendarPage(
  url: string,
  options: FetchOptions,
): Promise<string> {
  let lastErr = "";
  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt++) {
    throwIfAborted(options.signal);
    console.log(
      `[bampfa] fetching ${url} (attempt ${attempt}/${MAX_FETCH_ATTEMPTS})`,
    );
    try {
      const res = await fetch(url, {
        signal: signalWithTimeout(options.signal, FETCH_TIMEOUT_MS),
        headers: { "User-Agent": "Cal-Events-Discovery-Bot" },
        redirect: "follow",
      });
      if (!res.ok) {
        lastErr = `${res.status} ${res.statusText}`;
        console.warn(`[bampfa] non-2xx (${lastErr})`);
      } else {
        return await res.text();
      }
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      console.warn(`[bampfa] fetch error: ${lastErr}`);
    }
    if (attempt < MAX_FETCH_ATTEMPTS)
      await abortableDelay(RETRY_DELAY_MS * attempt, options.signal);
  }
  throw new Error(
    `BAMPFA fetch failed for ${url} after ${MAX_FETCH_ATTEMPTS} attempts: ${lastErr}`,
  );
}

/** Return YYYY-MM strings for the current month and the next MONTHS_AHEAD months. */
export function targetMonths(now = new Date()): string[] {
  const months: string[] = [];
  for (let i = 0; i <= MONTHS_AHEAD; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    months.push(`${y}-${m}`);
  }
  return months;
}

export function calendarUrlForMonth(ym: string): string {
  return `${CALENDAR_URL}/${ym}`;
}

export async function fetchBampfa(
  options: FetchOptions = {},
): Promise<FetchResult> {
  const todayIso = todayPT();
  const fetched_at = new Date().toISOString();
  const events: CanonicalEvent[] = [];
  let rawCount = 0;
  let filteredPast = 0;
  let invalid = 0;

  // Track seen canonical URLs to avoid duplicating recurring events that appear
  // across month boundaries in the scraped pages (same event, same date).
  const seenKeys = new Set<string>();

  const months = targetMonths();
  const pages = await Promise.all(
    months.map(async (ym) => {
      const pageUrl = calendarUrlForMonth(ym);
      try {
        return { ym, html: await fetchCalendarPage(pageUrl, options) };
      } catch (err) {
        console.warn(
          `[bampfa] skipping month ${ym}: ${err instanceof Error ? err.message : err}`,
        );
        return null;
      }
    }),
  );

  for (const page of pages) {
    if (!page) continue;
    const { html, ym } = page;

    const $ = cheerio.load(html);

    // Each event in the BAMPFA calendar has a Google Calendar "Add" link.
    // Selector: anchor tags whose href starts with the Google Calendar eventedit URL.
    $('a[href*="calendar.google.com/calendar/r/eventedit"]').each((_i, el) => {
      rawCount++;
      try {
        const href = $(el).attr("href") ?? "";
        const parsed = parseGCalLink(href);
        if (!parsed) {
          invalid++;
          return;
        }

        const {
          title,
          startToken,
          endToken,
          canonicalUrl,
          description,
          location,
        } = parsed;

        const { iso: start_at, allDay: all_day } = gcalTokenToIso(startToken);
        const end_at = endToken ? gcalTokenToIso(endToken).iso : undefined;

        // Filter past events using date prefix (YYYY-MM-DD).
        const eventDate = start_at.slice(0, 10);
        if (eventDate < todayIso) {
          filteredPast++;
          return;
        }

        // Deduplicate: same canonical URL + same date = same occurrence.
        const dedupeKey = `${canonicalUrl}::${eventDate}`;
        if (seenKeys.has(dedupeKey)) {
          return; // silently skip duplicate (not a past filter)
        }
        seenKeys.add(dedupeKey);

        // Derive a stable source_id from the event slug + date.
        const slugMatch = canonicalUrl.match(/\/event\/([^/?#]+)/);
        const slug = slugMatch ? slugMatch[1] : canonicalUrl;
        const source_id = `${slug}::${eventDate}`;

        const candidate: CanonicalEvent = {
          source_name: "bampfa",
          source_id,
          source_url: CALENDAR_URL,
          evidence_url: canonicalUrl,
          title,
          description,
          start_at,
          end_at,
          timezone: "America/Los_Angeles",
          all_day,
          venue: location || "BAMPFA",
          building: "Berkeley Art Museum & Pacific Film Archive",
          address: "2155 Center St, Berkeley, CA 94720",
          modality: "in_person",
          organizer: "BAMPFA",
          organizer_unit: "BAMPFA",
          audience: "",
          cost: "",
          registration_url: undefined,
          canonical_url: canonicalUrl,
          categories: ["Arts"],
          tags: ["Arts"],
          last_seen_at: fetched_at,
          confidence: 0.95,
          quality_flags: [],
        };

        const validated = CanonicalEventSchema.safeParse(candidate);
        if (!validated.success) {
          invalid++;
          if (invalid <= 5) {
            console.warn(
              `[bampfa] schema reject "${title}": ${validated.error.issues
                .map((i) => `${i.path.join(".")}:${i.message}`)
                .join("; ")}`,
            );
          }
          return;
        }
        events.push(validated.data);
      } catch {
        invalid++;
      }
    });

    console.log(
      `[bampfa] month ${ym}: collected ${events.length} events so far`,
    );
  }

  console.log(
    `[bampfa] parsed ${events.length}/${rawCount} (past: ${filteredPast}, invalid: ${invalid})`,
  );
  return { events, rawCount, filteredPast, invalid };
}
