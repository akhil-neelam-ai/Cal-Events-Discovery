/**
 * CalLink (CampusGroups) JSON adapter — student organization events.
 *
 * callink.berkeley.edu runs on Anthology Engage (CampusLabs). The public
 * discovery API at /api/discovery/event/search returns upcoming, approved,
 * public events without authentication. Pagination is hard-capped by the
 * platform — the API returns up to ~16 featured upcoming events regardless
 * of $skip or $top. We fetch the full public window (status=Approved,
 * endsAfter=now, $top=200) and accept whatever the platform surfaces.
 *
 * Event fields:  id, name, description (HTML), organizationName, location,
 *   startsOn (ISO 8601 with UTC offset), endsOn, theme, categoryNames,
 *   visibility ("Public"), status ("Approved"), latitude, longitude.
 */

import type { CanonicalEvent } from "../lib/schema.js";
import { CanonicalEventSchema } from "../lib/schema.js";
import { signalWithTimeout, type FetchOptions } from "../lib/abort.js";

const BASE_URL = "https://callink.berkeley.edu";
const DISCOVERY_API = `${BASE_URL}/api/discovery/event/search`;
const FETCH_TIMEOUT_MS = 30_000;
const MAX_EVENTS = 200;

export interface FetchResult {
  events: CanonicalEvent[];
  rawCount: number;
  filteredPast: number;
  invalid: number;
}

/** Strip HTML tags from CampusGroups rich-text description fields. */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&ndash;/g, "\u2013")
    .replace(/&ldquo;/g, "\u201c")
    .replace(/&rdquo;/g, "\u201d")
    .replace(/\s+/g, " ")
    .trim();
}

/** Map CampusGroups "theme" values to frontend-friendly category labels. */
const THEME_MAP: Record<string, string> = {
  Arts: "Arts",
  Athletics: "Sports",
  CommunityService: "Student Life",
  Cultural: "Student Life",
  Fundraising: "Student Life",
  GroupBusiness: "Student Life",
  Social: "Student Life",
  Spirituality: "Student Life",
  ThoughtfulLearning: "Academic",
  Unknown: "Student Life",
};

function categorizeCampusGroups(
  theme: string,
  categoryNames: string[],
): string[] {
  const cats = new Set<string>();

  const mappedTheme = THEME_MAP[theme];
  if (mappedTheme) cats.add(mappedTheme);

  for (const cat of categoryNames) {
    const lower = cat.toLowerCase();
    if (
      /\b(academic|education|lecture|seminar|panel|talk|workshop|research|learning)\b/.test(
        lower,
      )
    ) {
      cats.add("Academic");
    } else if (
      /\b(art|music|film|performance|gallery|theater|dance|creative)\b/.test(
        lower,
      )
    ) {
      cats.add("Arts");
    } else if (
      /\b(sport|athletic|fitness|recreation|intramural)\b/.test(lower)
    ) {
      cats.add("Sports");
    } else if (
      /\b(tech|computer|engineer|science|data|ai|stem|hack)\b/.test(lower)
    ) {
      cats.add("Science & Tech");
    } else if (
      /\b(entrepreneur|startup|innovation|venture|business|pitch)\b/.test(lower)
    ) {
      cats.add("Entrepreneurship");
    }
  }

  if (cats.size === 0) cats.add("Student Life");
  return Array.from(cats);
}

function todayPT(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

const PT_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function eventDateInPT(startAt: string): string {
  const parsed = new Date(startAt);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return PT_DATE_FORMATTER.format(parsed);
}

interface RawCampusGroupsEvent {
  id: string;
  name: string;
  description?: string;
  organizationName?: string;
  location?: string;
  startsOn?: string;
  endsOn?: string;
  theme?: string;
  categoryNames?: string[];
  visibility?: string;
  status?: string;
  latitude?: string | null;
  longitude?: string | null;
}

interface ApiResponse {
  "@odata.count"?: number;
  value?: RawCampusGroupsEvent[];
}

export async function fetchCallink(
  options: FetchOptions = {},
): Promise<FetchResult> {
  const todayIso = todayPT();
  const nowUtc = new Date().toISOString();
  const fetched_at = nowUtc;

  const params = new URLSearchParams({
    endsAfter: nowUtc,
    status: "Approved",
    $top: String(MAX_EVENTS),
  });

  const url = `${DISCOVERY_API}?${params.toString()}`;
  console.log(`[callink] fetching ${url}`);

  const response = await fetch(url, {
    signal: signalWithTimeout(options.signal, FETCH_TIMEOUT_MS),
    headers: {
      "User-Agent": "Cal-Events-Discovery-Bot",
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `CalLink fetch failed: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as ApiResponse;
  const raw = data.value ?? [];
  const apiTotal = data["@odata.count"] ?? raw.length;

  console.log(
    `[callink] API returned ${raw.length} items (odata.count: ${apiTotal})`,
  );

  const events: CanonicalEvent[] = [];
  let rawCount = 0;
  let filteredPast = 0;
  let invalid = 0;

  for (const item of raw) {
    rawCount++;

    try {
      if (!item.id || !item.name?.trim()) {
        invalid++;
        continue;
      }

      // Skip non-public or unapproved events defensively
      if (item.visibility && item.visibility !== "Public") {
        invalid++;
        continue;
      }

      const start_at = item.startsOn;
      if (!start_at) {
        invalid++;
        continue;
      }

      const eventDate = eventDateInPT(start_at);
      if (!eventDate) {
        invalid++;
        continue;
      }

      if (eventDate < todayIso) {
        filteredPast++;
        continue;
      }

      const end_at = item.endsOn ?? undefined;
      const title = item.name.trim();
      const description = item.description
        ? stripHtml(item.description)
        : title;
      const organizer = item.organizationName ?? "";
      const venue = item.location ?? "";
      const categories = categorizeCampusGroups(
        item.theme ?? "",
        item.categoryNames ?? [],
      );
      const canonical_url = `${BASE_URL}/event/${item.id}`;

      const candidate: CanonicalEvent = {
        source_name: "callink",
        source_id: item.id,
        source_url: DISCOVERY_API,
        evidence_url: canonical_url,
        title,
        description,
        start_at,
        end_at,
        timezone: "America/Los_Angeles",
        all_day: false,
        venue,
        building: "",
        address: "",
        modality: "in_person",
        organizer,
        organizer_unit: organizer,
        audience: "",
        cost: "",
        registration_url: undefined,
        canonical_url,
        categories,
        tags: categories,
        last_seen_at: fetched_at,
        confidence: 0.9,
        quality_flags: [],
      };

      const validated = CanonicalEventSchema.safeParse(candidate);
      if (!validated.success) {
        invalid++;
        if (invalid <= 5) {
          console.warn(
            `[callink] schema reject "${title}": ${validated.error.issues.map((i) => `${i.path.join(".")}:${i.message}`).join("; ")}`,
          );
        }
        continue;
      }
      events.push(validated.data);
    } catch (err) {
      invalid++;
      if (invalid <= 5) {
        console.warn(
          `[callink] failed to parse event: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  console.log(
    `[callink] parsed ${events.length}/${rawCount} (past: ${filteredPast}, invalid: ${invalid})`,
  );
  return { events, rawCount, filteredPast, invalid };
}
