/**
 * Cal Bears athletics iCal adapter.
 *
 * calbears.com runs on Sidearm Sports CMS, which publishes a composite
 * athletics calendar as RFC 5545 iCalendar at /calendar.ashx/calendar.ics.
 * Each VEVENT carries a stable game ID in the UID, opponent, location,
 * result (for past games), and broadcast info in the description.
 *
 * Discovery path: /calendar.ics and /calendar/composite.ics both issue 302s
 * that ultimately resolve to /calendar.ashx/calendar.ics (text/calendar).
 */

import ical, { type VEvent } from "node-ical";
import type { CanonicalEvent } from "../lib/schema.js";
import { CanonicalEventSchema } from "../lib/schema.js";
import { isoDateInPT } from "../lib/normalize.js";

const FEED_URL = "https://calbears.com/calendar.ashx/calendar.ics";
const FETCH_TIMEOUT_MS = 30_000;
const MAX_FETCH_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1_500;
// Sidearm feeds for a full athletic program typically have 100+ games per season.
const MIN_HEALTHY_EVENT_COUNT = 20;

export interface FetchResult {
  events: CanonicalEvent[];
  rawCount: number;
  filteredPast: number;
  invalid: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "val" in (value as object)) {
    return String((value as { val: unknown }).val ?? "");
  }
  return "";
}

function isAllDay(component: VEvent): boolean {
  const datetype = (component as unknown as { datetype?: string }).datetype;
  return datetype === "date";
}

function isoDateUTC(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayPT(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function decodeIcalText(text: string): string {
  return text
    .replace(/\\n/g, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .replace(/&amp;/g, "&")
    .replace(/&#160;/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Sidearm SUMMARY lines start with a bracket tag: [H] = home, [A] = away,
 * [N] = neutral site, [W] = completed win, [L] = completed loss.
 * Strip the tag so the title reads cleanly.
 */
function cleanSummary(summary: string): string {
  return summary.replace(/^\[[A-Z]\]\s*/i, "").trim();
}

/**
 * Infer home/away/neutral from the bracket tag in the Sidearm SUMMARY.
 * Returns a quality flag if the tag indicates the game is already over.
 */
function parseGameFlags(summary: string): {
  modality: "in_person";
  isHome: boolean;
  isPast: boolean;
} {
  const tag = /^\[([A-Z])\]/i.exec(summary)?.[1]?.toUpperCase() ?? "";
  return {
    modality: "in_person",
    isHome: tag === "H",
    isPast: tag === "W" || tag === "L",
  };
}

async function fetchFeed(): Promise<Record<string, unknown>> {
  let lastErr = "";
  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt++) {
    console.log(
      `[calbears] fetching ${FEED_URL} (attempt ${attempt}/${MAX_FETCH_ATTEMPTS})`,
    );
    try {
      const res = await fetch(FEED_URL, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { "User-Agent": "Cal-Events-Discovery-Bot" },
        redirect: "follow",
      });
      if (!res.ok) {
        lastErr = `${res.status} ${res.statusText}`;
        console.warn(`[calbears] non-2xx (${lastErr})`);
      } else {
        const ics = await res.text();
        const parsed = ical.sync.parseICS(ics);
        const veventCount = Object.values(parsed).filter(
          (c) => (c as { type?: string }).type === "VEVENT",
        ).length;
        if (veventCount >= MIN_HEALTHY_EVENT_COUNT) {
          return parsed;
        }
        lastErr = `short feed (${veventCount} VEVENTs, need ≥ ${MIN_HEALTHY_EVENT_COUNT})`;
        console.warn(`[calbears] ${lastErr}`);
      }
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      console.warn(`[calbears] fetch error: ${lastErr}`);
    }
    if (attempt < MAX_FETCH_ATTEMPTS) await sleep(RETRY_DELAY_MS * attempt);
  }
  throw new Error(
    `Cal Bears fetch failed after ${MAX_FETCH_ATTEMPTS} attempts: ${lastErr}`,
  );
}

export async function fetchCalBears(): Promise<FetchResult> {
  const parsed = await fetchFeed();

  const todayIso = todayPT();
  const fetched_at = new Date().toISOString();
  const events: CanonicalEvent[] = [];
  let rawCount = 0;
  let filteredPast = 0;
  let invalid = 0;

  for (const key of Object.keys(parsed)) {
    const component = parsed[key] as { type?: string };
    if (!component || component.type !== "VEVENT") continue;
    const ve = component as unknown as VEvent;
    rawCount++;

    try {
      const startDate = ve.start as Date;
      const endDate = ve.end as Date | undefined;
      if (!startDate) {
        invalid++;
        continue;
      }

      const allDay = isAllDay(ve);
      const start_at = allDay ? isoDateUTC(startDate) : startDate.toISOString();
      const end_at = endDate
        ? allDay
          ? isoDateUTC(endDate)
          : endDate.toISOString()
        : undefined;

      const eventDate = isoDateInPT(start_at);
      if (eventDate < todayIso) {
        filteredPast++;
        continue;
      }

      const rawSummary = decodeIcalText(asString(ve.summary));
      const { isHome, isPast } = parseGameFlags(rawSummary);
      // Double-check: Sidearm sometimes puts past results with future DTSTART due to
      // timezone differences on same-day games. The [W]/[L] tag is the reliable signal.
      if (isPast) {
        filteredPast++;
        continue;
      }

      const title = cleanSummary(rawSummary);
      if (!title) {
        invalid++;
        continue;
      }

      const description = decodeIcalText(asString(ve.description));
      const rawLocation = decodeIcalText(asString(ve.location));

      // Sidearm location format: "City, ST, Venue Name" or "City, ST"
      // Use everything after the first comma-space as the venue, or the whole string.
      const locationParts = rawLocation.split(", ");
      const venue =
        locationParts.length >= 3
          ? locationParts.slice(2).join(", ")
          : rawLocation;

      const rawUrl = asString(ve.url).replace(/&amp;/g, "&");
      const uid = asString((ve as unknown as { uid?: unknown }).uid);
      const url = rawUrl || `https://calbears.com/calendar.aspx#${uid}`;

      const quality_flags: string[] = [];
      if (!isHome) quality_flags.push("away_or_neutral");

      const candidate: CanonicalEvent = {
        source_name: "calbears",
        source_id: uid || key,
        source_url: FEED_URL,
        evidence_url: url,
        title,
        description,
        start_at,
        end_at,
        timezone: "America/Los_Angeles",
        all_day: allDay,
        venue,
        building: "",
        address: "",
        modality: "in_person",
        organizer: "Cal Athletics",
        organizer_unit: "Cal Athletics",
        audience: "",
        cost: "",
        registration_url: undefined,
        canonical_url: url,
        categories: ["Sports"],
        tags: ["Sports"],
        last_seen_at: fetched_at,
        confidence: 1,
        quality_flags,
      };

      const validated = CanonicalEventSchema.safeParse(candidate);
      if (!validated.success) {
        invalid++;
        if (invalid <= 5) {
          console.warn(
            `[calbears] schema reject "${title}": ${validated.error.issues
              .map((i) => `${i.path.join(".")}:${i.message}`)
              .join("; ")}`,
          );
        }
        continue;
      }
      events.push(validated.data);
    } catch (err) {
      invalid++;
      if (invalid <= 5) {
        console.warn(
          `[calbears] failed to parse VEVENT: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  console.log(
    `[calbears] parsed ${events.length}/${rawCount} (past: ${filteredPast}, invalid: ${invalid})`,
  );
  return { events, rawCount, filteredPast, invalid };
}
