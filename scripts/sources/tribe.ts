/**
 * Generic adapter for The Events Calendar (Tribe / Stellar) WordPress plugin.
 *
 * Both haas.berkeley.edu and www.law.berkeley.edu run this plugin and expose
 * a clean REST API at `/wp-json/tribe/events/v1/events`. Shape:
 *   - id (stable), title (HTML-entity-encoded), url
 *   - utc_start_date / utc_end_date — already UTC-normalized ISO-ish strings
 *   - start_date_details / end_date_details — local components
 *   - timezone ("America/Los_Angeles"), all_day, is_virtual
 *   - description (HTML), excerpt
 *   - venue: nested { venue, address, city, state, country }
 *   - organizer: nested or array of { organizer }
 *   - categories, tags: arrays of { name }
 *   - cost, cost_details
 *
 * We paginate until `total_pages` is exhausted, filter past events by PT
 * date, and project each Tribe event into CanonicalEvent. One adapter, many
 * hosts.
 */

import * as cheerio from "cheerio";
import type { CanonicalEvent, SourceName } from "../lib/schema.js";
import { CanonicalEventSchema } from "../lib/schema.js";
import { deriveFrontendTags } from "../lib/normalize.js";
import type { FetchOptions } from "../lib/abort.js";
import { fetchWithRetry } from "../lib/fetchWithRetry.js";

const FETCH_TIMEOUT_MS = 30_000;
const PER_PAGE = 100;
const MAX_PAGES = 10;

export interface FetchResult {
  events: CanonicalEvent[];
  rawCount: number;
  filteredPast: number;
  invalid: number;
}

export interface TribeSourceConfig {
  /** SourceName enum value written into each CanonicalEvent. */
  sourceName: SourceName;
  /** Base URL of the WordPress site (no trailing slash). */
  baseUrl: string;
  /** Human-readable organizer label used when Tribe doesn't include one. */
  defaultOrganizer: string;
  /** Organizer unit label for the canonical event. */
  defaultOrganizerUnit: string;
  /** Fallback address when the event's venue record has none. */
  defaultAddress: string;
  /** Frontend category bucket (e.g. 'Academic'). */
  defaultCategory: string;
}

function todayPT(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function stripHtml(html: string): string {
  const $ = cheerio.load(html);
  $("script, style").remove();
  $("br").replaceWith(" ");
  $("p, div, li").append(" ");

  return $.root().text().replace(/\s+/g, " ").trim();
}

interface TribeOrganizer {
  organizer?: string;
  url?: string;
}

interface TribeVenue {
  venue?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
}

interface TribeCategory {
  name?: string;
  slug?: string;
}

interface TribeEvent {
  id?: number | string;
  title?: string;
  url?: string;
  description?: string;
  excerpt?: string;
  start_date?: string;
  end_date?: string;
  utc_start_date?: string;
  utc_end_date?: string;
  timezone?: string;
  all_day?: boolean;
  is_virtual?: boolean;
  venue?: TribeVenue | TribeVenue[] | false;
  organizer?: TribeOrganizer | TribeOrganizer[] | false;
  categories?: TribeCategory[];
  tags?: TribeCategory[];
  cost?: string;
  status?: string;
}

interface TribeResponse {
  events?: TribeEvent[];
  total?: number;
  total_pages?: number;
  next_rest_url?: string;
}

async function fetchPage(
  url: string,
  logPrefix: string,
  options: FetchOptions,
): Promise<TribeResponse> {
  const res = await fetchWithRetry(
    url,
    {
      headers: {
        "User-Agent": "Cal-Events-Discovery-Bot",
        Accept: "application/json",
      },
      redirect: "follow",
    },
    {
      signal: options.signal,
      timeoutMs: FETCH_TIMEOUT_MS,
      label: logPrefix.replace(/^\[|\]$/g, ""),
    },
  );

  return (await res.json()) as TribeResponse;
}

/** Tribe returns `venue: false` when there's none — normalize to a plain object. */
function firstOf<T>(v: T | T[] | false | undefined): T | undefined {
  if (!v) return undefined;
  if (Array.isArray(v)) return v[0];
  return v;
}

/**
 * Tribe's `utc_start_date` is a human-friendly UTC string like
 * "2026-04-19 17:00:00" — no timezone suffix but guaranteed UTC. Convert to
 * ISO 8601 with an explicit Z so downstream consumers interpret it correctly
 * on any runner (PT locally, UTC on GitHub Actions).
 */
function utcStringToIso(s: string | undefined): string | undefined {
  if (!s) return undefined;
  // Already has a T separator and Z/offset? Pass through.
  if (/[TZ]|[+-]\d{2}:?\d{2}$/.test(s)) return s;
  return s.replace(" ", "T") + "Z";
}

export async function fetchTribe(
  config: TribeSourceConfig,
  options: FetchOptions = {},
): Promise<FetchResult> {
  const todayIso = todayPT();
  const fetched_at = new Date().toISOString();
  const logPrefix = `[${config.sourceName}]`;

  const events: CanonicalEvent[] = [];
  let rawCount = 0;
  let filteredPast = 0;
  let invalid = 0;

  const seenIds = new Set<string>();

  const baseApi = `${config.baseUrl}/wp-json/tribe/events/v1/events`;
  let pageUrl: string | null =
    `${baseApi}?per_page=${PER_PAGE}&start_date=${todayIso}&status=publish`;

  for (let page = 1; page <= MAX_PAGES && pageUrl; page++) {
    console.log(`${logPrefix} fetching page ${page}: ${pageUrl}`);
    const data = await fetchPage(pageUrl, logPrefix, options);
    const pageEvents = data.events ?? [];
    if (pageEvents.length === 0) break;

    for (const raw of pageEvents) {
      rawCount++;

      try {
        if (!raw.id || !raw.title?.trim() || !raw.url) {
          invalid++;
          continue;
        }
        if (raw.status && raw.status !== "publish") {
          invalid++;
          continue;
        }

        const sourceId = String(raw.id);
        if (seenIds.has(sourceId)) continue; // defensive against duplicate paginated returns
        seenIds.add(sourceId);

        // Prefer the UTC field — it's unambiguous. Fall back to the local
        // string if UTC is missing (rare); Tribe sets timezone explicitly.
        const start_at =
          utcStringToIso(raw.utc_start_date) ??
          utcStringToIso(raw.start_date) ??
          "";
        if (!start_at) {
          invalid++;
          continue;
        }
        const end_at =
          utcStringToIso(raw.utc_end_date) ?? utcStringToIso(raw.end_date);

        // Filter past events by PT date of the start.
        const startDate = new Date(start_at);
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

        const title = stripHtml(raw.title);
        const description = stripHtml(
          raw.description || raw.excerpt || raw.title,
        );

        const venue = firstOf(raw.venue);
        const organizer = firstOf(raw.organizer);
        const venueName = venue?.venue ? stripHtml(venue.venue) : "";
        const venueAddress = [venue?.address, venue?.city, venue?.state]
          .filter(Boolean)
          .map((s) => stripHtml(s as string))
          .join(", ");

        const categoryNames = (raw.categories ?? [])
          .map((c) => (c.name ? stripHtml(c.name) : ""))
          .filter(Boolean);
        const organizerName = organizer?.organizer
          ? stripHtml(organizer.organizer)
          : config.defaultOrganizer;
        const tags = deriveFrontendTags({
          title,
          description,
          categories: categoryNames,
          organizer: organizerName,
        });

        const candidate: CanonicalEvent = {
          source_name: config.sourceName,
          source_id: sourceId,
          source_url: baseApi,
          evidence_url: raw.url,
          title,
          description,
          start_at,
          end_at,
          timezone: raw.timezone || "America/Los_Angeles",
          all_day: Boolean(raw.all_day),
          venue: venueName,
          building: "",
          address: venueAddress || config.defaultAddress,
          modality: raw.is_virtual ? "virtual" : "in_person",
          organizer: organizerName,
          organizer_unit: config.defaultOrganizerUnit,
          audience: "",
          cost: raw.cost ? stripHtml(raw.cost) : "",
          registration_url: undefined,
          canonical_url: raw.url,
          categories: categoryNames.length
            ? categoryNames
            : [config.defaultCategory],
          tags,
          last_seen_at: fetched_at,
          confidence: 0.95,
          quality_flags: [],
        };

        const validated = CanonicalEventSchema.safeParse(candidate);
        if (!validated.success) {
          invalid++;
          if (invalid <= 5) {
            console.warn(
              `${logPrefix} schema reject "${title}": ${validated.error.issues
                .map((i) => `${i.path.join(".")}:${i.message}`)
                .join("; ")}`,
            );
          }
          continue;
        }
        events.push(validated.data);
      } catch (err) {
        invalid++;
        if (invalid <= 3) {
          console.warn(
            `${logPrefix} parse error: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
    }

    // Tribe gives a next_rest_url when more pages exist; stop when exhausted.
    if (data.next_rest_url) {
      pageUrl = data.next_rest_url;
    } else if (
      typeof data.total_pages === "number" &&
      page < data.total_pages
    ) {
      pageUrl = `${baseApi}?per_page=${PER_PAGE}&start_date=${todayIso}&status=publish&page=${page + 1}`;
    } else {
      pageUrl = null;
    }
  }

  console.log(
    `${logPrefix} parsed ${events.length}/${rawCount} (past: ${filteredPast}, invalid: ${invalid})`,
  );
  return { events, rawCount, filteredPast, invalid };
}

export function fetchHaas(options: FetchOptions = {}): Promise<FetchResult> {
  return fetchTribe(
    {
      sourceName: "haas",
      baseUrl: "https://haas.berkeley.edu",
      defaultOrganizer: "Berkeley Haas",
      defaultOrganizerUnit: "Berkeley Haas School of Business",
      defaultAddress: "2220 Piedmont Ave, Berkeley, CA 94720",
      defaultCategory: "Entrepreneurship",
    },
    options,
  );
}

export function fetchBerkeleyLaw(
  options: FetchOptions = {},
): Promise<FetchResult> {
  return fetchTribe(
    {
      sourceName: "berkeley_law",
      baseUrl: "https://www.law.berkeley.edu",
      defaultOrganizer: "Berkeley Law",
      defaultOrganizerUnit: "UC Berkeley School of Law",
      defaultAddress: "215 Law Building, Berkeley, CA 94720",
      defaultCategory: "Academic",
    },
    options,
  );
}

export function fetchBegin(options: FetchOptions = {}): Promise<FetchResult> {
  return fetchTribe(
    {
      sourceName: "begin",
      baseUrl: "https://begin.berkeley.edu",
      defaultOrganizer: "Berkeley Gateway to Innovation",
      defaultOrganizerUnit: "BEGIN",
      defaultAddress: "UC Berkeley, Berkeley, CA 94720",
      defaultCategory: "Entrepreneurship",
    },
    options,
  );
}
