/**
 * BEGIN (Berkeley Gateway to Innovation) iCal adapter.
 *
 * begin.berkeley.edu moved off WordPress in October 2026, and the old Tribe
 * REST endpoint now returns 410 Gone. The new site publishes every upcoming
 * event as RFC 5545 iCalendar at /api/public/events.ics, which robots.txt
 * explicitly allows. Each VEVENT carries a slug-based UID, TZID-local
 * DTSTART/DTEND, SUMMARY, DESCRIPTION, LOCATION, and the event page URL.
 * The feed has no ORGANIZER or CATEGORIES, and many events are hosted by
 * other units (SCET, eHub, Haas), so tags come from the text.
 */

import ical from "node-ical";
import type { FetchOptions } from "../lib/abort.js";
import { fetchWithRetry } from "../lib/fetchWithRetry.js";
import type { CanonicalEvent, FetchResult } from "../lib/schema.js";
import { CanonicalEventSchema } from "../lib/schema.js";
import {
  deriveFrontendTags,
  endedBeforePT,
  sanitizeDescription,
  todayPT,
} from "../lib/normalize.js";

const BASE_URL = "https://begin.berkeley.edu";
const FEED_URL = `${BASE_URL}/api/public/events.ics`;
const FETCH_TIMEOUT_MS = 30_000;
const ORGANIZER = "Berkeley Gateway to Innovation";

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "val" in (value as object)) {
    return String((value as { val: unknown }).val ?? "");
  }
  return "";
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isoDateUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function parseBeginIcs(
  ics: string,
  fetched_at: string,
  todayIso: string,
): FetchResult {
  const parsed = ical.sync.parseICS(ics);
  const events: CanonicalEvent[] = [];
  let rawCount = 0;
  let filteredPast = 0;
  let invalid = 0;

  for (const [key, component] of Object.entries(parsed)) {
    if (component?.type !== "VEVENT") continue;
    const ve = component;
    rawCount++;

    try {
      const startDate = ve.start as Date | undefined;
      const endDate = ve.end as Date | undefined;
      if (!startDate || isNaN(startDate.getTime())) {
        invalid++;
        continue;
      }

      const allDay = ve.datetype === "date";
      const start_at = allDay ? isoDateUTC(startDate) : startDate.toISOString();
      const end_at = endDate
        ? allDay
          ? isoDateUTC(endDate)
          : endDate.toISOString()
        : undefined;

      if (endedBeforePT({ start_at, end_at, all_day: allDay }, todayIso)) {
        filteredPast++;
        continue;
      }

      const title = cleanText(asString(ve.summary));
      if (!title) {
        invalid++;
        continue;
      }

      const description =
        sanitizeDescription(asString(ve.description)) || title;
      const venue = cleanText(asString(ve.location));
      const uid = asString(ve.uid) || key;
      const url =
        asString(ve.url) ||
        `${BASE_URL}/events/${uid.replace(/@begin\.berkeley\.edu$/, "")}`;
      const isVirtual = /^(livestream|online|virtual|zoom)\b/i.test(venue);

      const candidate: CanonicalEvent = {
        source_name: "begin",
        source_id: uid,
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
        modality: isVirtual ? "virtual" : "in_person",
        organizer: ORGANIZER,
        organizer_unit: "BEGIN",
        audience: "",
        cost: "",
        registration_url: undefined,
        canonical_url: url,
        categories: ["Entrepreneurship"],
        tags: deriveFrontendTags({
          title,
          description,
          categories: ["Entrepreneurship"],
          organizer: ORGANIZER,
        }),
        last_seen_at: fetched_at,
        confidence: 0.95,
        quality_flags: [],
      };

      const validated = CanonicalEventSchema.safeParse(candidate);
      if (!validated.success) {
        invalid++;
        if (invalid <= 5) {
          console.warn(
            `[begin] schema reject "${title}": ${validated.error.issues
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
          `[begin] failed to parse VEVENT: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  return { events, rawCount, filteredPast, invalid };
}

export async function fetchBegin(
  options: FetchOptions = {},
): Promise<FetchResult> {
  const response = await fetchWithRetry(
    FEED_URL,
    { headers: { "User-Agent": "Cal-Events-Discovery-Bot" } },
    { signal: options.signal, timeoutMs: FETCH_TIMEOUT_MS, label: "begin" },
  );
  if (!response.ok) {
    throw new Error(
      `BEGIN fetch failed: ${response.status} ${response.statusText}`,
    );
  }

  const ics = await response.text();
  if (!/BEGIN:VCALENDAR/.test(ics)) {
    throw new Error("BEGIN feed is not iCalendar data");
  }

  const result = parseBeginIcs(ics, new Date().toISOString(), todayPT());
  console.log(
    `[begin] parsed ${result.events.length}/${result.rawCount} (past: ${result.filteredPast}, invalid: ${result.invalid})`,
  );
  return result;
}
