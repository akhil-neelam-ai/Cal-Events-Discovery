/**
 * Simons Institute for the Theory of Computing — JSON API adapter.
 *
 * simons.berkeley.edu exposes a public JSON API at /api/events returning all
 * events as an array. Fields: start (ISO 8601 UTC), end (ISO 8601, no tz on
 * end), title, url (relative), event_type, workshop_type, speakers, location.
 *
 * The endpoint returns ~2600 total events (historical + future); we filter to
 * today-or-future PT dates. Typical upcoming count: ~40–50 events including
 * workshops, the "Theoretically Speaking" public lecture series, reading
 * groups, and weekly Tea Time Talks.
 *
 * None of these events appear in the central LiveWhale feed at
 * events.berkeley.edu — the Simons Institute does not cross-publish to it.
 */

import type { CanonicalEvent } from "../lib/schema.js";
import { CanonicalEventSchema } from "../lib/schema.js";
import type { FetchOptions } from "../lib/abort.js";
import { fetchWithRetry } from "../lib/fetchWithRetry.js";

const BASE_URL = "https://simons.berkeley.edu";
const API_URL = `${BASE_URL}/api/events`;
const FETCH_TIMEOUT_MS = 30_000;
const PT_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export interface FetchResult {
  events: CanonicalEvent[];
  rawCount: number;
  filteredPast: number;
  invalid: number;
}

interface RawSimonsEvent {
  start?: string;
  end?: string;
  title?: string;
  url?: string;
  event_type?: string;
  workshop_type?: string;
  speakers?: string;
  location?: string;
  program?: string;
}

function todayPT(): string {
  return PT_DATE_FORMATTER.format(new Date());
}

function ptDateOf(utcIso: string): string {
  const d = new Date(utcIso);
  if (isNaN(d.getTime())) return "";
  return PT_DATE_FORMATTER.format(d);
}

/** Ensure an ISO timestamp has an explicit timezone suffix. */
function withZ(s: string): string {
  if (!s.includes("T")) return `${s}T00:00:00Z`;
  if (s.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(s)) return s;
  return `${s}Z`;
}

function categorize(eventType: string, workshopType: string): string[] {
  const s = `${eventType} ${workshopType}`.toLowerCase();
  if (/theoretically speaking|public lecture|karp/.test(s))
    return ["Science & Tech", "Academic"];
  return ["Science & Tech"];
}

export async function fetchSimons(
  options: FetchOptions = {},
): Promise<FetchResult> {
  const todayIso = todayPT();
  const fetched_at = new Date().toISOString();

  const res = await fetchWithRetry(
    API_URL,
    {
      headers: {
        "User-Agent": "Cal-Events-Discovery-Bot",
        Accept: "application/json",
      },
    },
    {
      signal: options.signal,
      timeoutMs: FETCH_TIMEOUT_MS,
      label: "simons",
    },
  );

  const raw: RawSimonsEvent[] = await res.json();

  const events: CanonicalEvent[] = [];
  let rawCount = 0;
  let filteredPast = 0;
  let invalid = 0;

  for (const item of raw) {
    rawCount++;
    try {
      if (!item.title?.trim() || !item.start || !item.url) {
        invalid++;
        continue;
      }

      // Skip cancelled events
      if (/^cancelled[:\s]/i.test(item.title)) {
        invalid++;
        continue;
      }

      const start_at = withZ(item.start);
      const ptDate = ptDateOf(start_at);
      if (!ptDate) {
        invalid++;
        continue;
      }
      if (ptDate < todayIso) {
        filteredPast++;
        continue;
      }

      const end_at = item.end ? withZ(item.end) : undefined;
      const canonicalUrl = item.url.startsWith("http")
        ? item.url
        : `${BASE_URL}${item.url}`;

      // Stable source_id: url slug + PT date (recurring events share slug)
      const slug = item.url.replace(/^\//, "").replace(/\//g, "-");
      const source_id = `${slug}::${ptDate}`;

      const description =
        [item.speakers?.trim(), item.program?.trim()]
          .filter(Boolean)
          .join(" — ") || item.title.trim();

      const categories = categorize(
        item.event_type ?? "",
        item.workshop_type ?? "",
      );

      const candidate: CanonicalEvent = {
        source_name: "simons",
        source_id,
        source_url: API_URL,
        evidence_url: canonicalUrl,
        title: item.title.trim(),
        description,
        start_at,
        end_at,
        timezone: "America/Los_Angeles",
        all_day: false,
        venue: item.location?.trim() || "Calvin Lab",
        building: "Calvin Lab",
        address: "Simons Institute, 121 Calvin Lab, Berkeley, CA 94720",
        modality: "in_person",
        organizer: "Simons Institute",
        organizer_unit: "Simons Institute for the Theory of Computing",
        audience: "",
        cost: "",
        registration_url: undefined,
        canonical_url: canonicalUrl,
        categories,
        tags: categories,
        last_seen_at: fetched_at,
        confidence: 0.95,
        quality_flags: [],
      };

      const validated = CanonicalEventSchema.safeParse(candidate);
      if (!validated.success) {
        invalid++;
        if (invalid <= 5) {
          console.warn(
            `[simons] schema reject "${item.title}": ${validated.error.issues
              .map((i) => `${i.path.join(".")}:${i.message}`)
              .join("; ")}`,
          );
        }
        continue;
      }
      events.push(validated.data);
    } catch {
      invalid++;
    }
  }

  console.log(
    `[simons] parsed ${events.length}/${rawCount} (past: ${filteredPast}, invalid: ${invalid})`,
  );
  return { events, rawCount, filteredPast, invalid };
}
