/**
 * CalLink (CampusGroups) JSON adapter — student organization events.
 *
 * callink.berkeley.edu runs on Anthology Engage (CampusLabs). The public
 * discovery API at /api/discovery/event/search returns upcoming, approved,
 * public events without authentication. It ignores OData `$top` and serves
 * 10 rows by default, so we page with Engage's own `take` and `skip` until
 * we reach `@odata.count` or MAX_EVENTS.
 *
 * Event fields:  id, name, description (HTML), organizationName, location,
 *   startsOn (ISO 8601 with UTC offset), endsOn, theme, categoryNames,
 *   visibility ("Public"), status ("Approved"), latitude, longitude.
 */

import type { CanonicalEvent, FetchResult } from "../lib/schema.js";
import { CanonicalEventSchema } from "../lib/schema.js";
import type { FetchOptions } from "../lib/abort.js";
import { fetchWithRetry } from "../lib/fetchWithRetry.js";
import {
  endedBeforePT,
  isoDateInPT,
  sanitizePlainText,
  todayPT,
} from "../lib/normalize.js";

const BASE_URL = "https://callink.berkeley.edu";
const DISCOVERY_API = `${BASE_URL}/api/discovery/event/search`;
const FETCH_TIMEOUT_MS = 30_000;
const MAX_EVENTS = 200;
const PAGE_SIZE = 50;

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

async function fetchPage(
  skip: number,
  endsAfter: string,
  options: FetchOptions,
): Promise<ApiResponse> {
  // The same query the Engage events page sends. A stable sort keeps
  // skip-based pages from overlapping.
  const params = new URLSearchParams({
    endsAfter,
    status: "Approved",
    orderByField: "endsOn",
    orderByDirection: "ascending",
    take: String(PAGE_SIZE),
    skip: String(skip),
  });

  const response = await fetchWithRetry(
    `${DISCOVERY_API}?${params.toString()}`,
    {
      headers: {
        "User-Agent": "Cal-Events-Discovery-Bot",
        Accept: "application/json",
      },
    },
    {
      signal: options.signal,
      timeoutMs: FETCH_TIMEOUT_MS,
      label: "callink",
    },
  );

  if (!response.ok) {
    throw new Error(
      `CalLink fetch failed: ${response.status} ${response.statusText}`,
    );
  }

  return (await response.json()) as ApiResponse;
}

export async function fetchCallink(
  options: FetchOptions = {},
): Promise<FetchResult> {
  const todayIso = todayPT();
  const nowUtc = new Date().toISOString();
  const fetched_at = nowUtc;

  const raw: RawCampusGroupsEvent[] = [];
  const seenIds = new Set<string>();
  let apiTotal: number | undefined;
  let offset = 0;

  while (raw.length < MAX_EVENTS) {
    const page = await fetchPage(offset, nowUtc, options);
    const items = page.value ?? [];
    if (typeof page["@odata.count"] === "number") {
      apiTotal = page["@odata.count"];
    }
    offset += items.length;

    let added = 0;
    for (const item of items) {
      if (item.id) {
        if (seenIds.has(item.id)) continue;
        seenIds.add(item.id);
      }
      raw.push(item);
      added++;
    }

    // Stop on an empty page, on a page with nothing new (the API ignored
    // `skip`), or once every counted event has arrived.
    if (added === 0 || (apiTotal !== undefined && offset >= apiTotal)) {
      break;
    }
  }
  raw.splice(MAX_EVENTS);

  console.log(
    `[callink] API returned ${raw.length} items (odata.count: ${apiTotal ?? "missing"})`,
  );
  if (apiTotal !== undefined && raw.length < Math.min(apiTotal, MAX_EVENTS)) {
    console.warn(
      `[callink] received ${raw.length} of ${apiTotal} events; take/skip paging may have changed`,
    );
  }

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

      const eventDate = isoDateInPT(start_at);
      if (!eventDate) {
        invalid++;
        continue;
      }

      const end_at = item.endsOn ?? undefined;
      if (endedBeforePT({ start_at, end_at, all_day: false }, todayIso)) {
        filteredPast++;
        continue;
      }

      const title = item.name.trim();
      const description = item.description
        ? sanitizePlainText(item.description)
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
