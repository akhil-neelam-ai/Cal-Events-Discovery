/**
 * LiveWhale iCal adapter — primary event source.
 *
 * events.berkeley.edu runs on LiveWhale. The /live/ical/events endpoint
 * publishes the full official campus calendar (~1,500 events) as RFC 5545
 * iCalendar. Each VEVENT carries a stable LiveWhale ID, organizer slug
 * embedded in the URL, location, optional categories, and timezone-aware
 * start/end timestamps.
 */

import ical, { type VEvent } from "node-ical";
import {
  abortableDelay,
  signalWithTimeout,
  type FetchOptions,
} from "../lib/abort.js";
import type { CanonicalEvent } from "../lib/schema.js";
import { CanonicalEventSchema } from "../lib/schema.js";
import { deriveFrontendTags, isoDateInPT } from "../lib/normalize.js";

const FEED_URL = "https://events.berkeley.edu/live/ical/events";
const GROUP_BASE = "https://events.berkeley.edu/live/ical/events/group";
const FETCH_TIMEOUT_MS = 30_000;
const MAX_FETCH_ATTEMPTS = 3;
const EMPTY_FEED_RETRY_DELAY_MS = 1_500;
// LiveWhale occasionally returns an empty calendar payload despite a 200 response.
// Anything below this threshold is treated as a flake and retried.
const MIN_HEALTHY_EVENT_COUNT = 50;

/**
 * Department-specific LiveWhale group feeds.
 * URL: https://events.berkeley.edu/live/ical/events/group/[slug]
 * These surface events that departments post only to their group calendar,
 * not to the main campus feed. Fetched in parallel; deduped by UID.
 */
const LIVEWHALE_GROUPS: string[] = [
  "physics",
  "Mathematics",
  "statistics",
  "integrative biology",
  "political science",
  "history",
  "economics",
  "psychology",
  "linguistics",
  "music",
  "German",
  "classics",
  "Buddhist Studies",
  "African American Studies",
  "bioengineering",
  "geography",
  "law",
  // New groups found in systematic sweep
  "library",
  "college of engineering",
  "botanical garden",
  "college of chemistry",
  "English",
  "Center for Race and Gender",
  "Institute of Governmental Studies",
  "Center for Korean Studies",
  "International House",
  "plant and microbial biology",
  "Social Science Matrix",
  "Human Rights Center",
  "Center for Japanese Studies",
  "graduate division",
  "Scandinavian",
  "Center for African Studies",
];

/**
 * Map known LiveWhale calendar slugs (the path segment after the host) to
 * a human-readable organizer unit. Anything missing falls back to the slug
 * itself, capitalized.
 *
 * Keys are normalized to lower-case at lookup time (LiveWhale uses a mix of
 * casing, e.g. `Library`, `BAMPFA`, `Magnes`).
 */
const ORG_UNIT_MAP: Record<string, string> = {
  ac: "Arts + Culture at Berkeley",
  africam: "African American Studies Department",
  apasd: "Asian Pacific American Student Development",
  are: "Agricultural & Resource Economics",
  arf: "Archaeological Research Facility",
  art: "Department of Art Practice",
  sports: "Cal Athletics",
  bot: "UC Botanical Garden",
  bph: "Berkeley Public Health",
  brc: "Berkeley Retirement Center",
  bcsr: "Berkeley Center for the Study of Religion",
  bs: "Buddhist Studies",
  bsac: "Berkeley Sensor & Actuator Center",
  ihouse: "International House",
  calperfs: "Cal Performances",
  calparents: "Cal Parents",
  ced: "College of Environmental Design",
  cee: "Civil & Environmental Engineering",
  serc: "Student Environmental Resource Center",
  chem: "Department of Chemistry",
  cjs: "Center for Japanese Studies",
  cks: "Center for Korean Studies",
  clacs: "Center for Latin American and Caribbean Studies",
  coe: "College of Engineering",
  crb: "Center for Responsible Business",
  crg: "Center for Race and Gender",
  csas: "Center for South Asia Studies",
  cseas: "Center for Southeast Asia Studies",
  cshe: "Center for Studies in Higher Education",
  csls: "Center for the Study of Law and Society",
  educ: "Berkeley School of Education",
  cdss: "College of Computing, Data Science, and Society",
  econ: "Department of Economics",
  extension: "UC Berkeley Extension",
  geneq: "Gender Equity Resource Center",
  geog: "Geography Department",
  hdi: "Helen Diller Institute",
  hr: "Human Resources",
  hrc: "Human Rights Center",
  ib: "Integrative Biology",
  ieas: "Institute of East Asian Studies",
  ies: "Institute of European Studies",
  igs: "Institute of Governmental Studies",
  ihd: "Institute of Human Development",
  ischool: "School of Information",
  issi: "Institute for the Study of Societal Issues",
  its: "Institute of Transportation Studies",
  jsp: "Jurisprudence and Social Policy Program",
  law: "Berkeley Law",
  lhs: "Lawrence Hall of Science",
  ling: "Department of Linguistics",
  mse: "Materials Science & Engineering",
  pmb: "Plant & Microbial Biology",
  publichealth: "School of Public Health",
  gspp: "Goldman School of Public Policy",
  haas: "Berkeley Haas",
  bampfa: "BAMPFA",
  bio: "Berkeley International Office",
  botanicalgarden: "UC Botanical Garden",
  bids: "Berkeley Institute for Data Science",
  citris: "CITRIS",
  cltc: "Center for Long-Term Cybersecurity",
  simons: "Simons Institute",
  scet: "Sutardja Center for Entrepreneurship & Technology",
  ssm: "Social Science Matrix",
  sp: "Spanish and Portuguese",
  tdps: "Theater, Dance, and Performance Studies",
  ttp: "Technology Transfer Program",
  udar: "University Development and Alumni Relations",
  uhs: "University Health Services",
  blumcenter: "Blum Center",
  ssl: "Space Sciences Laboratory",
  rdi: "Berkeley RDI",
  cnr: "College of Natural Resources",
  graddiv: "Graduate Division",
  library: "UC Berkeley Library",
  mcb: "Molecular & Cell Biology",
  physics: "Department of Physics",
  math: "Department of Mathematics",
  eecs: "EECS",
  ce: "Civil & Environmental Engineering",
  me: "Mechanical Engineering",
  bioe: "Bioengineering",
  // Units surfaced by redirect resolution on /live/events/ URLs
  magnes: "Magnes Collection of Jewish Art & Life",
  music: "Department of Music",
};

/**
 * Path segments that are LiveWhale platform namespaces, not organizer slugs.
 * `events.berkeley.edu/live/events/<id>` means "a generic event on the
 * LiveWhale platform" — the first segment is not an organizer. Similarly,
 * `/event/<id>` and `/events/<id>` on other hosts are generic paths. We
 * resolve the unit from the 302 redirect (events.berkeley.edu) or fall back
 * to "UC Berkeley" rather than mislabel these as "Live" / "Event" / "Events".
 */
const GENERIC_URL_SLUGS = new Set(["live", "event", "events"]);
const HOST_EVENTS_BERKELEY = "events.berkeley.edu";

/** Cache: /live/events/<slug> URL → resolved unit slug (after 302 redirect). */
const redirectSlugCache = new Map<string, string>();

/** Write to redirectSlugCache, clearing it when it exceeds 500 entries. */
function cacheSet(key: string, value: string): void {
  if (redirectSlugCache.size >= 500) redirectSlugCache.clear();
  redirectSlugCache.set(key, value);
}

/**
 * For events.berkeley.edu/live/events/<id> URLs, the LiveWhale server
 * 302-redirects to the unit-specific URL, e.g. /Library/event/<id>.
 * Some events first 301-redirect to an updated /live/events/ slug (title
 * change, "postponed" prefix added, etc.), then 302 to the unit — we follow
 * up to MAX_REDIRECT_HOPS hops to recover the unit slug in that chain.
 * We HEAD each URL to avoid downloading bodies.
 */
const MAX_REDIRECT_HOPS = 4;

async function resolveUnitSlugViaRedirect(
  url: string,
  options: FetchOptions = {},
): Promise<string> {
  if (redirectSlugCache.has(url)) return redirectSlugCache.get(url) || "";
  let current = url;
  try {
    for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop++) {
      const res = await fetch(current, {
        method: "HEAD",
        redirect: "manual",
        headers: { "User-Agent": "Cal-Events-Discovery-Bot" },
        signal: signalWithTimeout(options.signal, 8_000),
      });
      if (res.status < 300 || res.status >= 400) break;
      const loc = res.headers.get("location");
      if (!loc) break;
      const target = new URL(loc, current);
      const firstSeg = target.pathname.split("/").filter(Boolean)[0] || "";
      if (firstSeg && !GENERIC_URL_SLUGS.has(firstSeg.toLowerCase())) {
        cacheSet(url, firstSeg);
        return firstSeg;
      }
      // Still on a generic namespace — keep following.
      current = target.toString();
      if (current === url) break; // guard against loops
    }
  } catch {
    // Network error, timeout, etc — fall through.
  }
  cacheSet(url, "");
  return "";
}

function prettifySlug(slug: string): string {
  return slug.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function isAcronymLikeSlug(slug: string): boolean {
  const compact = slug.replace(/[^a-zA-Z]/g, "");
  return compact.length > 0 && compact.length <= 4;
}

export function unitFromSlug(slug: string): string {
  if (!slug) return "";
  const mapped = ORG_UNIT_MAP[slug.toLowerCase()];
  if (mapped) return mapped;
  if (isAcronymLikeSlug(slug)) return slug.toUpperCase();
  return prettifySlug(slug);
}

/**
 * Extract (slug, unit) from an event URL.
 * If the URL's first path segment is a generic LiveWhale namespace
 * ("live", "event", "events"), attempt to resolve the real unit via the
 * 302 redirect that LiveWhale serves for /live/events/<id> URLs.
 * On failure, fall back to "UC Berkeley" rather than emit "Live".
 */
async function unitFromUrl(
  url: string | undefined,
  options: FetchOptions = {},
): Promise<{ slug: string; unit: string }> {
  if (!url) return { slug: "", unit: "UC Berkeley" };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { slug: "", unit: "UC Berkeley" };
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  const firstSeg = segments[0] || "";
  const slugLower = firstSeg.toLowerCase();

  if (slugLower && !GENERIC_URL_SLUGS.has(slugLower)) {
    return { slug: firstSeg, unit: unitFromSlug(firstSeg) };
  }

  // Generic namespace — try the redirect trick for events.berkeley.edu.
  if (parsed.hostname === HOST_EVENTS_BERKELEY && slugLower === "live") {
    const resolved = await resolveUnitSlugViaRedirect(url, options);
    if (resolved) {
      return { slug: resolved, unit: unitFromSlug(resolved) };
    }
  }

  // Last-resort fallback: keep the generic slug for the quality flag,
  // but emit a neutral organizer name instead of "Live" / "Event" / "Events".
  return { slug: firstSeg, unit: "UC Berkeley" };
}

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "val" in (value as object)) {
    return String((value as { val: unknown }).val ?? "");
  }
  return "";
}

function isAllDay(component: VEvent): boolean {
  // node-ical sets datetype to 'date' for VALUE=DATE entries
  // (it leaves it as 'date-time' for TZID-anchored timestamps)
  const datetype = (component as unknown as { datetype?: string }).datetype;
  return datetype === "date";
}

function isoDateUTC(d: Date): string {
  // For all-day VEVENTs node-ical returns a Date at UTC midnight; format YYYY-MM-DD
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

export interface FetchResult {
  events: CanonicalEvent[];
  rawCount: number;
  filteredPast: number;
  invalid: number;
}

async function fetchFeed(
  url: string = FEED_URL,
  minEvents = MIN_HEALTHY_EVENT_COUNT,
  options: FetchOptions = {},
): Promise<Record<string, unknown>> {
  let lastErr = "";
  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt++) {
    console.log(
      `[livewhale] fetching ${url} (attempt ${attempt}/${MAX_FETCH_ATTEMPTS})`,
    );
    try {
      const res = await fetch(url, {
        signal: signalWithTimeout(options.signal, FETCH_TIMEOUT_MS),
        headers: { "User-Agent": "Cal-Events-Discovery-Bot" },
      });
      if (!res.ok) {
        lastErr = `${res.status} ${res.statusText}`;
        console.warn(`[livewhale] non-2xx (${lastErr})`);
      } else {
        const ics = await res.text();
        const parsed = ical.sync.parseICS(ics);
        const veventCount = Object.values(parsed).filter(
          (c) => (c as { type?: string }).type === "VEVENT",
        ).length;
        if (veventCount >= minEvents) {
          return parsed;
        }
        lastErr = `empty/short feed (${veventCount} VEVENTs, need ≥ ${minEvents})`;
        console.warn(`[livewhale] ${lastErr}`);
        // For group feeds a short response is often valid (small department) — don't retry
        if (minEvents === 0) return parsed;
      }
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      console.warn(`[livewhale] fetch error: ${lastErr}`);
    }
    if (attempt < MAX_FETCH_ATTEMPTS)
      await abortableDelay(EMPTY_FEED_RETRY_DELAY_MS * attempt, options.signal);
  }
  throw new Error(
    `LiveWhale fetch failed after ${MAX_FETCH_ATTEMPTS} attempts: ${lastErr}`,
  );
}

/** Fetch a single group feed, returning an empty object on any error (non-fatal). */
async function fetchGroupFeed(
  group: string,
  options: FetchOptions,
): Promise<Record<string, unknown>> {
  const url = `${GROUP_BASE}/${encodeURIComponent(group)}`;
  try {
    return await fetchFeed(url, 0, options); // minEvents=0: any response is acceptable
  } catch (err) {
    console.warn(
      `[livewhale] group feed "${group}" failed: ${err instanceof Error ? err.message : err}`,
    );
    return {};
  }
}

/**
 * Resolve redirects in parallel for any URLs whose first path segment is a
 * generic LiveWhale namespace ("live"). Populates `redirectSlugCache` so the
 * subsequent synchronous mapping pass can read results without awaiting.
 */
async function prewarmRedirectCache(
  urls: string[],
  options: FetchOptions,
): Promise<void> {
  const CONCURRENCY = 8;
  const toResolve: string[] = [];
  for (const u of urls) {
    try {
      const parsed = new URL(u);
      if (parsed.hostname !== HOST_EVENTS_BERKELEY) continue;
      const first = (
        parsed.pathname.split("/").filter(Boolean)[0] || ""
      ).toLowerCase();
      if (first === "live" && !redirectSlugCache.has(u)) toResolve.push(u);
    } catch {
      // skip invalid URLs
    }
  }
  if (toResolve.length === 0) return;
  console.log(
    `[livewhale] resolving ${toResolve.length} /live/events/ redirects (concurrency ${CONCURRENCY})`,
  );
  let idx = 0;
  const worker = async (): Promise<void> => {
    while (idx < toResolve.length) {
      const myIdx = idx++;
      await resolveUnitSlugViaRedirect(toResolve[myIdx], options);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

export async function fetchLiveWhale(
  options: FetchOptions = {},
): Promise<FetchResult> {
  // Fetch main feed + all group feeds in parallel
  const [mainParsed, ...groupResults] = await Promise.all([
    fetchFeed(FEED_URL, MIN_HEALTHY_EVENT_COUNT, options),
    ...LIVEWHALE_GROUPS.map((g) => fetchGroupFeed(g, options)),
  ]);

  // Merge all iCal records; deduplicate by UID (group feeds overlap with main)
  const merged: Record<string, unknown> = { ...mainParsed };
  for (const groupParsed of groupResults) {
    for (const [key, val] of Object.entries(groupParsed)) {
      if (!(key in merged)) merged[key] = val;
    }
  }

  const parsed = merged;

  const todayIso = todayPT();
  const fetched_at = new Date().toISOString();
  const events: CanonicalEvent[] = [];
  let rawCount = 0;
  let filteredPast = 0;
  let invalid = 0;

  // First pass: collect URLs that need redirect resolution, warm the cache in parallel.
  const urlsToPrewarm: string[] = [];
  for (const key of Object.keys(parsed)) {
    const component = parsed[key] as { type?: string };
    if (!component || component.type !== "VEVENT") continue;
    const ve = component as unknown as VEvent;
    const url =
      asString(ve.url) ||
      `https://events.berkeley.edu/live/events/${(ve as unknown as { uid?: string }).uid}`;
    urlsToPrewarm.push(url);
  }
  await prewarmRedirectCache(urlsToPrewarm, options);

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

      // Drop events that have already started before today (PT).
      // For multi-day events still upcoming or in progress, keep them.
      const eventDate = isoDateInPT(start_at);
      if (eventDate < todayIso) {
        filteredPast++;
        continue;
      }

      // Skip canceled/postponed events — check iCal STATUS field and title prefix.
      const icalStatus = asString(
        (ve as unknown as { status?: unknown }).status,
      ).toUpperCase();
      if (icalStatus === "CANCELLED" || icalStatus === "CANCELED") {
        invalid++;
        continue;
      }

      const summary = decodeIcalText(asString(ve.summary));
      if (/^(canceled|cancelled|postponed|rescheduled)[:\s]/i.test(summary)) {
        invalid++;
        continue;
      }

      const url =
        asString(ve.url) ||
        `https://events.berkeley.edu/live/events/${(ve as unknown as { uid?: string }).uid}`;
      const { slug, unit } = await unitFromUrl(url, options);

      const description = decodeIcalText(asString(ve.description));
      const location = decodeIcalText(asString(ve.location));
      const categoriesRaw = (
        ve as unknown as { categories?: string[] | string }
      ).categories;
      const categories = Array.isArray(categoriesRaw)
        ? categoriesRaw
        : typeof categoriesRaw === "string"
          ? [categoriesRaw]
          : [];

      const liveWhaleId =
        asString(
          (ve as unknown as { ["x-livewhale-id"]?: unknown })["x-livewhale-id"],
        ) || asString((ve as unknown as { uid?: unknown }).uid);

      const candidate: CanonicalEvent = {
        source_name: "livewhale",
        source_id: String(liveWhaleId),
        source_url: FEED_URL,
        evidence_url: url,
        title: summary,
        description,
        start_at,
        end_at,
        timezone: "America/Los_Angeles",
        all_day: allDay,
        venue: location,
        building: "",
        address: "",
        modality: "in_person",
        organizer: unit,
        organizer_unit: unit,
        audience: "",
        cost: "",
        registration_url: undefined,
        canonical_url: url,
        categories,
        tags: deriveFrontendTags({
          title: summary,
          description,
          categories,
          organizer: unit,
        }),
        last_seen_at: fetched_at,
        confidence: 1,
        quality_flags: !slug
          ? ["unknown_org_slug"]
          : GENERIC_URL_SLUGS.has(slug.toLowerCase())
            ? ["generic_org_slug"]
            : [],
      };

      const validated = CanonicalEventSchema.safeParse(candidate);
      if (!validated.success) {
        invalid++;
        if (invalid <= 5) {
          console.warn(
            `[livewhale] schema reject "${summary}": ${validated.error.issues.map((i) => `${i.path.join(".")}:${i.message}`).join("; ")}`,
          );
        }
        continue;
      }
      events.push(validated.data);
    } catch (err) {
      invalid++;
      if (invalid <= 5) {
        console.warn(
          `[livewhale] failed to parse VEVENT: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  console.log(
    `[livewhale] parsed ${events.length}/${rawCount} (past: ${filteredPast}, invalid: ${invalid})`,
  );
  return { events, rawCount, filteredPast, invalid };
}
