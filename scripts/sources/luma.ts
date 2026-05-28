/**
 * Luma events adapter for Berkeley-affiliated calendar pages.
 *
 * API endpoint: https://api.lu.ma/calendar/get-items?calendar_api_id=<id>
 * Returns upcoming events for the given calendar. Each entry carries a
 * lightweight event stub (name, times, url slug, location type, geo info) —
 * full descriptions are only available on the individual event page and
 * are omitted here to keep pipeline latency low.
 *
 * Calendar IDs were resolved from vanity slugs by inspecting each page's HTML.
 * To add a new calendar: find its Luma page, extract the `cal-<id>` from the
 * page source, and append an entry to BERKELEY_LUMA_CALENDARS below.
 */

import type { CanonicalEvent, SourceName } from "../lib/schema.js";
import { CanonicalEventSchema } from "../lib/schema.js";
import { deriveFrontendTags } from "../lib/normalize.js";
import type { FetchOptions } from "../lib/abort.js";
import { fetchWithRetry } from "../lib/fetchWithRetry.js";

const API_BASE = "https://api.lu.ma/calendar/get-items";
const FETCH_TIMEOUT_MS = 30_000;
const SOURCE_NAME: SourceName = "luma";

interface LumaCalendarConfig {
  calId: string;
  slug: string;
  organizer: string;
  organizerUnit: string;
  defaultAddress: string;
  defaultCategory: string;
}

// To add a new calendar: grab the vanity URL from luma.com, load the page,
// grep for `cal-<id>` in the HTML. Add an entry here with that id.
const BERKELEY_LUMA_CALENDARS: LumaCalendarConfig[] = [
  // Active (returning upcoming events as of 2026-05)
  {
    calId: "cal-4TEeXLXVUtUqg91",
    slug: "berkeleygatewayaccelerator",
    organizer: "Berkeley Gateway Accelerator",
    organizerUnit: "Berkeley Gateway Accelerator",
    defaultAddress: "Berkeley, CA",
    defaultCategory: "Entrepreneurship",
  },
  {
    calId: "cal-innEhgXVF8DutA2",
    slug: "venture-accelerator",
    organizer: "Venture Accelerator",
    organizerUnit: "Berkeley Venture Accelerator",
    defaultAddress: "Berkeley, CA",
    defaultCategory: "Entrepreneurship",
  },
  {
    calId: "cal-7lfE7NPvJ79Cogr",
    slug: "club-ai",
    organizer: "Club AI at Berkeley",
    organizerUnit: "Club AI",
    defaultAddress: "UC Berkeley, Berkeley, CA",
    defaultCategory: "Science & Tech",
  },
  // Valid calendars — returns events during the academic year
  {
    calId: "cal-NGX3EtNE8VjfQVv",
    slug: "rdi_uc_berkeley",
    organizer: "Berkeley RDI",
    organizerUnit: "Center for Responsible Decentralized Intelligence",
    defaultAddress: "UC Berkeley, Berkeley, CA",
    defaultCategory: "Science & Tech",
  },
  {
    calId: "cal-QzSyFbecenFng8a",
    slug: "berkeley-skydeck",
    organizer: "Berkeley SkyDeck",
    organizerUnit: "Berkeley SkyDeck Accelerator",
    defaultAddress: "2054 University Ave, Berkeley, CA",
    defaultCategory: "Entrepreneurship",
  },
  {
    calId: "cal-bHk5GbDeJ592eul",
    slug: "babreserve",
    organizer: "Berkeley Blockchain Ecosystem",
    organizerUnit: "Berkeley Blockchain",
    defaultAddress: "UC Berkeley, Berkeley, CA",
    defaultCategory: "Science & Tech",
  },
  {
    calId: "cal-zpmXtN6vl2q126O",
    slug: "notionatberkeley",
    organizer: "Notion @ UC Berkeley",
    organizerUnit: "Notion Campus Chapter",
    defaultAddress: "UC Berkeley, Berkeley, CA",
    defaultCategory: "Student Life",
  },
  {
    calId: "cal-0zC7mzBhjn1qZxF",
    slug: "blueprintucberkeley",
    organizer: "Blueprint @ Berkeley",
    organizerUnit: "Blueprint",
    defaultAddress: "UC Berkeley, Berkeley, CA",
    defaultCategory: "Student Life",
  },
  {
    calId: "cal-hBMWrE0GDEt47fE",
    slug: "berkeleymdes",
    organizer: "Berkeley Master of Design",
    organizerUnit: "UC Berkeley College of Environmental Design",
    defaultAddress: "Wurster Hall, UC Berkeley, Berkeley, CA",
    defaultCategory: "Arts",
  },
  {
    calId: "cal-5PR1bGQ6VjXuIIU",
    slug: "berchainev",
    organizer: "BerChain",
    organizerUnit: "BerChain Blockchain Community",
    defaultAddress: "Berkeley, CA",
    defaultCategory: "Science & Tech",
  },
  {
    calId: "cal-iqggsuizvbXSxoO",
    slug: "deeptech",
    organizer: "Deep Tech Innovation Lab",
    organizerUnit: "Berkeley Deep Tech Innovation Lab",
    defaultAddress: "UC Berkeley, Berkeley, CA",
    defaultCategory: "Science & Tech",
  },
  {
    calId: "cal-ECgZMptWPGOsxtE",
    slug: "sbc",
    organizer: "Science of Blockchain Conference",
    organizerUnit: "Stanford Center for Blockchain Research / Berkeley",
    defaultAddress: "UC Berkeley, Berkeley, CA",
    defaultCategory: "Science & Tech",
  },
];

interface LumaGeoInfo {
  mode?: string;
  full_address?: string;
  city_state?: string;
  city?: string;
}

interface LumaEvent {
  api_id?: string;
  name?: string;
  start_at?: string;
  end_at?: string;
  timezone?: string;
  url?: string;
  location_type?: string;
  geo_address_info?: LumaGeoInfo | null;
}

interface LumaEntry {
  event: LumaEvent;
}

interface LumaApiResponse {
  entries?: LumaEntry[];
  has_more?: boolean;
  next_cursor?: string;
}

export interface FetchResult {
  events: CanonicalEvent[];
  rawCount: number;
  filteredPast: number;
  invalid: number;
}

function todayPT(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function resolveModality(
  locationType: string | undefined,
): "in_person" | "virtual" | "hybrid" {
  if (locationType === "online") return "virtual";
  if (locationType === "hybrid") return "hybrid";
  return "in_person";
}

async function fetchCalendar(
  cal: LumaCalendarConfig,
  todayIso: string,
  fetched_at: string,
  options: FetchOptions,
): Promise<{
  events: CanonicalEvent[];
  rawCount: number;
  filteredPast: number;
  invalid: number;
}> {
  const logPrefix = `[luma:${cal.slug}]`;
  const events: CanonicalEvent[] = [];
  let rawCount = 0;
  let filteredPast = 0;
  let invalid = 0;

  const url = new URL(API_BASE);
  url.searchParams.set("calendar_api_id", cal.calId);

  let data: LumaApiResponse;
  try {
    const res = await fetchWithRetry(
      url.toString(),
      {
        headers: {
          "User-Agent": "Cal-Events-Discovery-Bot",
          Accept: "application/json",
        },
      },
      {
        signal: options.signal,
        timeoutMs: FETCH_TIMEOUT_MS,
        label: `luma:${cal.calId}`,
      },
    );
    data = (await res.json()) as LumaApiResponse;
  } catch (err) {
    console.warn(
      `${logPrefix} fetch failed: ${err instanceof Error ? err.message : err}`,
    );
    return { events, rawCount, filteredPast, invalid };
  }

  const entries = data.entries ?? [];
  rawCount = entries.length;

  for (const entry of entries) {
    const ev = entry.event;
    if (!ev.api_id || !ev.name?.trim() || !ev.url || !ev.start_at) {
      invalid++;
      continue;
    }

    const startDate = new Date(ev.start_at);
    if (isNaN(startDate.getTime())) {
      invalid++;
      continue;
    }

    const eventPtDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(startDate);

    if (eventPtDate < todayIso) {
      filteredPast++;
      continue;
    }

    const title = ev.name.trim();
    const address =
      ev.geo_address_info?.full_address ||
      ev.geo_address_info?.city_state ||
      ev.geo_address_info?.city ||
      cal.defaultAddress;
    const modality = resolveModality(ev.location_type);
    const eventUrl = `https://lu.ma/${ev.url}`;

    const tags = deriveFrontendTags({
      title,
      description: "",
      categories: [cal.defaultCategory],
      organizer: cal.organizer,
    });

    const candidate: CanonicalEvent = {
      source_name: SOURCE_NAME,
      source_id: ev.api_id,
      source_url: `https://luma.com/${cal.slug}`,
      evidence_url: eventUrl,
      title,
      description: "",
      start_at: ev.start_at,
      end_at: ev.end_at,
      timezone: ev.timezone || "America/Los_Angeles",
      all_day: false,
      venue: "",
      building: "",
      address,
      modality,
      organizer: cal.organizer,
      organizer_unit: cal.organizerUnit,
      audience: "",
      cost: "",
      registration_url: eventUrl,
      canonical_url: eventUrl,
      categories: [cal.defaultCategory],
      tags,
      last_seen_at: fetched_at,
      confidence: 0.9,
      quality_flags: [],
    };

    const validated = CanonicalEventSchema.safeParse(candidate);
    if (!validated.success) {
      invalid++;
      if (invalid <= 3) {
        console.warn(
          `${logPrefix} schema reject "${title}": ${validated.error.issues
            .map((i) => `${i.path.join(".")}:${i.message}`)
            .join("; ")}`,
        );
      }
      continue;
    }
    events.push(validated.data);
  }

  console.log(
    `${logPrefix} ${events.length}/${rawCount} (past: ${filteredPast}, invalid: ${invalid})`,
  );
  return { events, rawCount, filteredPast, invalid };
}

export async function fetchLuma(
  options: FetchOptions = {},
): Promise<FetchResult> {
  const todayIso = todayPT();
  const fetched_at = new Date().toISOString();

  const results = await Promise.allSettled(
    BERKELEY_LUMA_CALENDARS.map((cal) =>
      fetchCalendar(cal, todayIso, fetched_at, options),
    ),
  );

  const allEvents: CanonicalEvent[] = [];
  let totalRaw = 0;
  let totalFilteredPast = 0;
  let totalInvalid = 0;

  for (const result of results) {
    if (result.status === "fulfilled") {
      allEvents.push(...result.value.events);
      totalRaw += result.value.rawCount;
      totalFilteredPast += result.value.filteredPast;
      totalInvalid += result.value.invalid;
    }
  }

  console.log(
    `[luma] total: ${allEvents.length}/${totalRaw} events across ${BERKELEY_LUMA_CALENDARS.length} calendars`,
  );
  return {
    events: allEvents,
    rawCount: totalRaw,
    filteredPast: totalFilteredPast,
    invalid: totalInvalid,
  };
}
