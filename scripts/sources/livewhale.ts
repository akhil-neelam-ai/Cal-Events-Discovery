/**
 * LiveWhale iCal adapter — primary event source.
 *
 * events.berkeley.edu runs on LiveWhale. The /live/ical/events endpoint
 * publishes the official campus calendar as RFC 5545 iCalendar. Each VEVENT
 * carries a stable LiveWhale ID, organizer slug embedded in the URL,
 * location, optional categories, and timezone-aware start/end timestamps.
 *
 * The bare endpoint silently stops at roughly 930-970 events (about two
 * weeks ahead), and some responses are cut off mid-event with no
 * END:VCALENDAR. So the main feed is fetched as consecutive weekly date
 * windows, every response must be a complete calendar, and an incomplete
 * window is split into smaller windows, which have rendered completely.
 */

import ical, { type VEvent } from "node-ical";
import {
  abortableDelay,
  signalWithTimeout,
  type FetchOptions,
} from "../lib/abort.js";
import { fetchWithRetry } from "../lib/fetchWithRetry.js";
import type { CanonicalEvent, FetchResult } from "../lib/schema.js";
import { CanonicalEventSchema } from "../lib/schema.js";
import {
  addDaysToKey,
  deriveFrontendTags,
  endedBeforePT,
  todayPT,
} from "../lib/normalize.js";

const FEED_URL = "https://events.berkeley.edu/live/ical/events";
const GROUP_BASE = "https://events.berkeley.edu/live/ical/events/group";
const JSON_BASE = "https://events.berkeley.edu/live/json/events";
const JSON_MAX_PAGES = 5;
const FETCH_TIMEOUT_MS = 15_000;
const WINDOW_FETCH_ATTEMPTS = 2;
const RETRY_DELAY_MS = 1_500;
// The required windows together must hold at least this many events. A
// smaller total means LiveWhale served a near-empty calendar.
const MIN_HEALTHY_EVENT_COUNT = 50;
// Windows start a week back so events that began earlier and are still
// running are included, then step a week at a time eight weeks ahead.
const WINDOW_LOOKBACK_DAYS = 7;
const WINDOW_DAYS = 7;
const WINDOW_AHEAD_WEEKS = 8;
// The lookback window and the next two weeks are required: losing one
// degrades LiveWhale. Later weeks are recorded in failed_windows instead.
const REQUIRED_WINDOW_COUNT = 3;
// The bare feed's silent cap returned 926 to 968 events in probes. A window
// near it may be missing events, so it is split.
const WINDOW_SPLIT_THRESHOLD = 900;
// Windows, group feeds, and redirect lookups each run through a pool of this
// size, so events.berkeley.edu never sees more parallel connections.
const LIVEWHALE_CONCURRENCY = 8;
/** The orchestrator's time budget for this adapter (windows, groups, redirects). */
export const LIVEWHALE_ADAPTER_TIMEOUT_MS = 90_000;
// Group feeds stop here, so a slow upstream fails them (recorded, topics
// carried forward) instead of timing out the whole adapter and discarding
// the required windows with it.
const OPTIONAL_WORK_DEADLINE_MS = 60_000;

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
  // Added via group-feed probe 2026-05-25
  "Institute of East Asian Studies",
  "Institute for South Asia Studies",
  "Institute of European Studies",
  "Lawrence Hall of Science",
  "School of Information",
  "Helen Wills Neuroscience Institute",
  "College of Environmental Design",
  // Added via a sweep of all 287 LiveWhale groups on 2026-10-30. The feed
  // URL takes the group's full name exactly: "and" for "&" returns a valid
  // empty calendar, so a typo fails silently.
  "Featured Events",
  "Haas School of Business",
  "Townsend Center for the Humanities",
  "Molecular and Cell Biology",
  "Theater, Dance, and Performance Studies",
  "College of Letters & Science",
  "Berkeley Public Health",
  "Industrial Engineering and Operations Research",
  "Berkeley Initiative of Behavioral Science (BIBS)",
  "QB3",
  "Berkeley Institute for Data Science",
  "College of Computing, Data Science, and Society",
  "Global, International and Area Studies",
  "Rausser College of Natural Resources",
  "Civil and Environmental Engineering",
  "Electrical Engineering & Computer Sciences",
  "Fung Institute for Engineering Leadership",
  "Comparative Literature",
  "Materials Science and Engineering",
  "Folklore",
  "Space Sciences Laboratory",
  "Tang Center for Silk Road Studies",
  // Student-life calendars, added 2026-10-30 after CalLink went behind a
  // CampusLabs login. "Student Events: The Big "C"alendar:" is LiveWhale's
  // campus-wide student events calendar.
  'Student Events: The Big "C"alendar:',
  "ASUC Student Union",
  "Student Environmental Resource Center",
  "Native American Student Development",
  "Asian Pacific American Student Development Office",
  "Basic Needs Center",
  "Student Learning Center",
  "Ethnic Studies",
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
  recsports: "Recreational Sports",
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

// Eight weeks of windows hold several hundred unique /live/events/ URLs. The
// cap stays well above that, so prewarmed entries are never evicted before
// the mapping loop reads them.
const REDIRECT_CACHE_MAX = 5_000;

/** Write to redirectSlugCache, evicting the oldest entry when it is full. */
function cacheSet(key: string, value: string): void {
  if (
    !redirectSlugCache.has(key) &&
    redirectSlugCache.size >= REDIRECT_CACHE_MAX
  ) {
    const oldestKey = redirectSlugCache.keys().next().value;
    if (oldestKey) {
      redirectSlugCache.delete(oldestKey);
    }
  }

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

// node-ical types uid/datetype/status/categories on VEvent already; only
// LiveWhale's non-standard X-LIVEWHALE-ID is missing. Extend once rather than
// double-casting at each access site.
interface ExtendedVEvent extends VEvent {
  "x-livewhale-id"?: unknown;
}

function isAllDay(component: VEvent): boolean {
  // node-ical sets datetype to 'date' for VALUE=DATE entries
  // (it leaves it as 'date-time' for TZID-anchored timestamps)
  return component.datetype === "date";
}

function isoDateUTC(d: Date): string {
  // For all-day VEVENTs node-ical returns a Date at UTC midnight; format YYYY-MM-DD
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function eventTimes(
  ve: VEvent,
): { start_at: string; end_at: string | undefined; all_day: boolean } | null {
  const startDate = ve.start as Date | undefined;
  const endDate = ve.end as Date | undefined;
  if (!startDate) return null;
  const allDay = isAllDay(ve);
  return {
    start_at: allDay ? isoDateUTC(startDate) : startDate.toISOString(),
    end_at: endDate
      ? allDay
        ? isoDateUTC(endDate)
        : endDate.toISOString()
      : undefined,
    all_day: allDay,
  };
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

/** A calendar that was cut off mid-response. Smaller windows can recover it. */
class IncompleteCalendarError extends Error {
  constructor(
    message: string,
    /** The last cut-off body, so its complete events can be salvaged. */
    readonly body: string,
  ) {
    super(message);
  }
}

/**
 * Keep the complete events of a cut-off calendar: everything up to the last
 * END:VEVENT, closed with END:VCALENDAR. Some single days come back cut on
 * every request, and losing the rest of one day beats failing the source.
 */
function salvageCutCalendar(body: string): Record<string, unknown> {
  const lastEnd = body.lastIndexOf("END:VEVENT");
  if (lastEnd === -1) return {};
  return ical.sync.parseICS(
    `${body.slice(0, lastEnd + "END:VEVENT".length)}\r\nEND:VCALENDAR\r\n`,
  );
}

/**
 * A real calendar starts with BEGIN:VCALENDAR and ends with END:VCALENDAR.
 * LiveWhale sometimes cuts a response off mid-event, and node-ical parses
 * that as a calendar with no events, so the ending is checked too.
 */
function calendarProblem(
  ics: string,
): { message: string; incomplete: boolean } | null {
  if (!ics.includes("BEGIN:VCALENDAR")) {
    return { message: "response is not an iCal calendar", incomplete: false };
  }
  if (!ics.trimEnd().endsWith("END:VCALENDAR")) {
    return {
      message: "response is an incomplete iCal calendar (no END:VCALENDAR)",
      incomplete: true,
    };
  }
  return null;
}

/**
 * Fetch and parse one LiveWhale calendar. Every attempt must return a
 * complete calendar. The last failure is thrown, as an
 * IncompleteCalendarError when the body was a cut-off calendar.
 */
async function fetchCalendar(
  url: string,
  label: string,
  maxAttempts: number,
  options: FetchOptions,
): Promise<Record<string, unknown>> {
  let lastErr = "";
  let cutBody: string | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetchWithRetry(
        url,
        {
          headers: { "User-Agent": "Cal-Events-Discovery-Bot" },
        },
        {
          signal: options.signal,
          timeoutMs: FETCH_TIMEOUT_MS,
          label,
          maxAttempts: 1,
        },
      );
      const ics = await res.text();
      const problem = calendarProblem(ics);
      if (!problem) return ical.sync.parseICS(ics);
      lastErr = problem.message;
      cutBody = problem.incomplete ? ics : null;
      console.warn(`[${label}] ${lastErr}`);
      // The same URL returns the same cut body, so a retry only spends time;
      // the caller recovers a cut calendar with smaller windows instead.
      if (cutBody !== null) break;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      cutBody = null;
      console.warn(`[${label}] fetch error: ${lastErr}`);
    }

    if (attempt < maxAttempts) {
      await abortableDelay(RETRY_DELAY_MS * attempt, options.signal);
    }
  }

  const message = `LiveWhale fetch failed after ${maxAttempts} ${maxAttempts === 1 ? "attempt" : "attempts"}: ${lastErr}`;
  throw cutBody !== null
    ? new IncompleteCalendarError(message, cutBody)
    : new Error(message);
}

function veventCount(parsed: Record<string, unknown>): number {
  return Object.values(parsed).filter(
    (c) => (c as { type?: string }).type === "VEVENT",
  ).length;
}

/**
 * Runs tasks with at most `limit` in flight. Urgent tasks (main-feed windows
 * and their splits) start before any queued ordinary task (group feeds), so a
 * split window never waits behind 60 group feeds.
 */
type Limiter = <T>(task: () => Promise<T>, urgent?: boolean) => Promise<T>;

function createLimiter(limit: number): Limiter {
  let active = 0;
  const urgentQueue: (() => void)[] = [];
  const ordinaryQueue: (() => void)[] = [];
  return async (task, urgent = false) => {
    if (active < limit) {
      active++;
    } else {
      // The finishing task hands its slot straight to this waiter.
      await new Promise<void>((resolve) =>
        (urgent ? urgentQueue : ordinaryQueue).push(resolve),
      );
    }
    try {
      return await task();
    } finally {
      const next = urgentQueue.shift() ?? ordinaryQueue.shift();
      if (next) next();
      else active--;
    }
  };
}

/**
 * Date keys for the main-feed windows, from a PT date key: a week back, then
 * weekly to eight weeks ahead. Consecutive keys form one window each.
 */
export function liveWhaleWindowKeys(todayKey: string): string[] {
  const keys: string[] = [];
  for (
    let offset = -WINDOW_LOOKBACK_DAYS;
    offset <= WINDOW_AHEAD_WEEKS * WINDOW_DAYS;
    offset += WINDOW_DAYS
  ) {
    keys.push(addDaysToKey(todayKey, offset));
  }
  return keys;
}

/**
 * LiveWhale's end_date is exclusive for timed events, so a window from
 * `start` to `end` holds start..end-1 and the next window starts at `end`.
 */
function liveWhaleWindowUrl(start: string, end: string): string {
  return `${FEED_URL}/start_date/${start}/end_date/${end}`;
}

function daysBetween(start: string, end: string): number {
  return Math.round(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) /
      86_400_000,
  );
}

interface LiveWhaleJsonEvent {
  id: string | number;
  title?: string | null;
  url?: string | null;
  date_utc?: string | null;
  date_iso?: string | null;
  date2_iso?: string | null;
  is_all_day?: string | number | boolean | null;
  is_canceled?: string | number | boolean | null;
  location?: string | null;
  description?: string | null;
  event_types?: string[] | string | null;
}

function decodeHtmlEntities(text: string): string {
  // An out-of-range code point would make fromCodePoint throw; keep it as is.
  const fromCode = (match: string, code: number) =>
    code <= 0x10ffff ? String.fromCodePoint(code) : match;
  return text
    .replace(/&#x([0-9a-f]+);/gi, (match, hex: string) =>
      fromCode(match, parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (match, dec: string) => fromCode(match, Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function isTruthyFlag(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

/**
 * Turn a LiveWhale JSON event into the shape node-ical gives a VEVENT. The
 * UID follows LiveWhale's iCal pattern (UTC start, then the event ID), so the
 * same event from a group feed merges with it.
 */
function veventFromJson(
  event: LiveWhaleJsonEvent,
): Record<string, unknown> | null {
  if (!event.id || !event.title || !event.date_iso || !event.date_utc) {
    return null;
  }
  const allDay = isTruthyFlag(event.is_all_day);
  const startKey = event.date_iso.slice(0, 10);
  const start = allDay
    ? new Date(`${startKey}T00:00:00Z`)
    : new Date(event.date_iso);
  if (isNaN(start.getTime())) return null;
  const endKey = event.date2_iso?.slice(0, 10);
  const end = allDay
    ? new Date(`${addDaysToKey(endKey ?? startKey, 1)}T00:00:00Z`)
    : event.date2_iso
      ? new Date(event.date2_iso)
      : undefined;
  const utcStamp = event.date_utc.replace(/[-: ]/g, "");
  return {
    type: "VEVENT",
    uid: `${utcStamp.slice(0, 8)}T${utcStamp.slice(8, 14)}Z-${event.id}@events.berkeley.edu`,
    "x-livewhale-id": String(event.id),
    datetype: allDay ? "date" : "date-time",
    start,
    end,
    summary: decodeHtmlEntities(event.title),
    description: decodeHtmlEntities(event.description ?? ""),
    location: decodeHtmlEntities(event.location ?? ""),
    url: event.url ?? undefined,
    categories: Array.isArray(event.event_types)
      ? event.event_types.filter((type) => typeof type === "string")
      : typeof event.event_types === "string"
        ? event.event_types.split(/,\s*/).filter(Boolean)
        : [],
    status: isTruthyFlag(event.is_canceled) ? "CANCELLED" : undefined,
  };
}

/**
 * Fetch one calendar from LiveWhale's JSON feed, which has rendered every
 * event on days and groups the iCal feed cuts off. `path` is the part after
 * `/live/json/events/`. Returns null when the JSON feed fails too.
 */
async function fetchJsonCalendar(
  path: string,
  limit: Limiter,
  options: FetchOptions,
  urgent: boolean,
): Promise<Record<string, unknown> | null> {
  let url: string | null =
    `${JSON_BASE}/${path}/response_fields/location,description,event_types`;
  const calendar: Record<string, unknown> = {};
  try {
    // The feed pages at 100 rows; a busy day has two pages.
    for (let page = 0; url && page < JSON_MAX_PAGES; page++) {
      const pageUrl: string = url;
      const body = (await limit(async () => {
        const res = await fetchWithRetry(
          pageUrl,
          { headers: { "User-Agent": "Cal-Events-Discovery-Bot" } },
          {
            signal: options.signal,
            timeoutMs: FETCH_TIMEOUT_MS,
            label: "livewhale-json",
            maxAttempts: 1,
          },
        );
        return (await res.json()) as unknown;
      }, urgent)) as { data?: unknown; links?: { next?: unknown } } | null;
      if (!body || !Array.isArray(body.data)) return null;
      for (const row of body.data as LiveWhaleJsonEvent[]) {
        try {
          const vevent = veventFromJson(row);
          if (vevent) calendar[String(vevent.uid)] = vevent;
        } catch {
          // One malformed row must not discard the rest of the day.
        }
      }
      url = typeof body.links?.next === "string" ? body.links.next : null;
    }
    // A day longer than the page cap is only partly refilled; report it.
    return url ? null : calendar;
  } catch (err) {
    console.warn(
      `[livewhale] JSON refill for ${path} failed: ${err instanceof Error ? err.message : err}`,
    );
    return null;
  }
}

interface WindowResult {
  parts: Record<string, unknown>[];
  /**
   * Windows that failed even at their smallest size. Only one that
   * `degrades` (an error page or network failure) can fail the source; a cut
   * day or an empty week is reported instead.
   */
  failures: { start: string; error: string; degrades: boolean }[];
}

/**
 * Fetch one window. A cut-off response, or one near the silent cap, is
 * refetched as two halves, down to single days.
 */
async function fetchWindow(
  start: string,
  end: string,
  limit: Limiter,
  options: FetchOptions,
): Promise<WindowResult> {
  const days = daysBetween(start, end);
  // Days fetch in parallel, so a cut week costs one extra round trip
  // instead of three halvings in a row.
  const splitIntoDays = async (): Promise<WindowResult> => {
    const results = await Promise.all(
      Array.from({ length: days }, (_, offset) => {
        const day = addDaysToKey(start, offset);
        return fetchWindow(day, addDaysToKey(day, 1), limit, options);
      }),
    );
    return {
      parts: results.flatMap((result) => result.parts),
      failures: results.flatMap((result) => result.failures),
    };
  };
  const split = async (): Promise<WindowResult> => {
    const mid = addDaysToKey(start, Math.floor(days / 2));
    const halves = await Promise.all([
      fetchWindow(start, mid, limit, options),
      fetchWindow(mid, end, limit, options),
    ]);
    return {
      parts: halves.flatMap((half) => half.parts),
      failures: halves.flatMap((half) => half.failures),
    };
  };

  let parsed: Record<string, unknown>;
  try {
    parsed = await limit(
      () =>
        fetchCalendar(
          liveWhaleWindowUrl(start, end),
          "livewhale",
          WINDOW_FETCH_ATTEMPTS,
          options,
        ),
      true,
    );
  } catch (err) {
    if (err instanceof IncompleteCalendarError) {
      if (days > 1) {
        console.warn(
          `[livewhale] window ${start}..${end} was incomplete; fetching its days`,
        );
        return splitIntoDays();
      }
      const salvaged = salvageCutCalendar(err.body);
      const refill = await fetchJsonCalendar(
        `start_date/${start}/end_date/${end}`,
        limit,
        options,
        true,
      );
      // A refill counts only when it holds at least what the cut body did.
      if (
        refill &&
        veventCount(refill) > 0 &&
        veventCount(refill) >= veventCount(salvaged)
      ) {
        console.warn(
          `[livewhale] day ${start} stays cut off; filled it from the JSON feed`,
        );
        return { parts: [salvaged, refill], failures: [] };
      }
      console.warn(
        `[livewhale] day ${start} stays cut off; kept its ${veventCount(salvaged)} complete events`,
      );
      return {
        parts: [salvaged],
        failures: [{ start, error: err.message, degrades: false }],
      };
    }
    return {
      parts: [],
      failures: [
        {
          start,
          error: err instanceof Error ? err.message : String(err),
          degrades: true,
        },
      ],
    };
  }

  let count = veventCount(parsed);
  if (count === 0 && days >= WINDOW_DAYS) {
    // No real campus week is empty, so retry once before reporting it.
    try {
      parsed = await limit(
        () =>
          fetchCalendar(
            liveWhaleWindowUrl(start, end),
            "livewhale",
            1,
            options,
          ),
        true,
      );
      count = veventCount(parsed);
    } catch (err) {
      // A retry that comes back cut goes through the split path.
      if (err instanceof IncompleteCalendarError) {
        console.warn(
          `[livewhale] window ${start}..${end} was incomplete; splitting it`,
        );
        return split();
      }
    }
    if (count === 0) {
      console.warn(`[livewhale] window ${start}..${end} returned no events`);
      return {
        parts: [],
        failures: [
          { start, error: "window returned no events", degrades: false },
        ],
      };
    }
  }
  if (count >= WINDOW_SPLIT_THRESHOLD) {
    if (days > 1) {
      console.warn(
        `[livewhale] window ${start}..${end} returned ${count} events, near the feed cap; splitting it`,
      );
      return split();
    }
    console.warn(
      `[livewhale] one-day window ${start} returned ${count} events, near the feed cap; some may be missing`,
    );
  }
  return { parts: [parsed], failures: [] };
}

/** Merge calendars by VEVENT UID, keeping the first copy of each. */
function mergeCalendarsByUid(
  calendars: readonly Record<string, unknown>[],
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  const seenUids = new Set<string>();
  for (const calendar of calendars) {
    for (const [key, value] of Object.entries(calendar)) {
      const uid = eventUid(key, value);
      if (uid) {
        if (seenUids.has(uid)) continue;
        seenUids.add(uid);
      }
      if (!(key in merged)) merged[key] = value;
    }
  }
  return merged;
}

export interface LiveWhaleMainFeed {
  parsed: Record<string, unknown>;
  failedWindows: string[];
}

/**
 * Fetch the main feed as weekly windows. A required window that failed
 * outright throws; a later window, or a cut day that kept its complete
 * events, is reported instead.
 */
async function fetchMainWindows(
  limit: Limiter,
  options: FetchOptions,
): Promise<LiveWhaleMainFeed> {
  const keys = liveWhaleWindowKeys(todayPT());
  const windows = await Promise.all(
    keys
      .slice(0, -1)
      .map((start, index) =>
        fetchWindow(start, keys[index + 1], limit, options),
      ),
  );

  const required = windows.slice(0, REQUIRED_WINDOW_COUNT);
  const requiredFailure = required
    .flatMap((w) => w.failures)
    .find((failure) => failure.degrades);
  if (requiredFailure) {
    throw new Error(
      `LiveWhale required window from ${requiredFailure.start} failed: ${requiredFailure.error}`,
    );
  }
  const requiredCount = veventCount(
    mergeCalendarsByUid(required.flatMap((w) => w.parts)),
  );
  if (requiredCount < MIN_HEALTHY_EVENT_COUNT) {
    throw new Error(
      `LiveWhale required windows returned ${requiredCount} VEVENTs, need ≥ ${MIN_HEALTHY_EVENT_COUNT}`,
    );
  }

  const failedWindows = windows.flatMap((w) =>
    w.failures.map((failure) => failure.start),
  );
  if (failedWindows.length > 0) {
    console.warn(
      `[livewhale] ${failedWindows.length} window(s) failed or were cut; their dates may be missing events: ${failedWindows.join(", ")}`,
    );
  }
  return {
    parsed: mergeCalendarsByUid(windows.flatMap((w) => w.parts)),
    failedWindows,
  };
}

export interface LiveWhaleGroupFeedResult {
  group: string;
  parsed: Record<string, unknown>;
  ok: boolean;
}

export function groupFeedsAreDegraded(
  results: readonly { ok: boolean }[],
): boolean {
  return results.length > 0 && results.every((result) => !result.ok);
}

/**
 * Fetch a single group feed. A group gives up after one attempt, so one
 * broken group cannot spend the adapter's time budget on retries. Failures
 * are recorded; they are not visitor degradation.
 */
async function fetchGroupFeed(
  group: string,
  limit: Limiter,
  options: FetchOptions,
): Promise<LiveWhaleGroupFeedResult> {
  const url = `${GROUP_BASE}/${encodeURIComponent(group)}`;
  try {
    return {
      group,
      parsed: await limit(() =>
        fetchCalendar(url, "livewhale-group", 1, options),
      ),
      ok: true,
    };
  } catch (err) {
    // A cut group feed is refilled from the JSON feed, like a cut day.
    if (err instanceof IncompleteCalendarError) {
      const salvaged = salvageCutCalendar(err.body);
      const refill = await fetchJsonCalendar(
        `group/${encodeURIComponent(group)}`,
        limit,
        options,
        false,
      );
      if (
        refill &&
        veventCount(refill) > 0 &&
        veventCount(refill) >= veventCount(salvaged)
      ) {
        console.warn(
          `[livewhale] group feed "${group}" was cut off; filled it from the JSON feed`,
        );
        return {
          group,
          parsed: mergeCalendarsByUid([salvaged, refill]),
          ok: true,
        };
      }
    }
    console.warn(
      `[livewhale] group feed "${group}" failed: ${err instanceof Error ? err.message : err}`,
    );
    return { group, parsed: {}, ok: false };
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
    `[livewhale] resolving ${toResolve.length} /live/events/ redirects (concurrency ${LIVEWHALE_CONCURRENCY})`,
  );
  const limit = createLimiter(LIVEWHALE_CONCURRENCY);
  await Promise.all(
    toResolve.map((url) =>
      limit(() => resolveUnitSlugViaRedirect(url, options)),
    ),
  );
}

/**
 * Fetch every group feed through the shared pool instead of opening one
 * simultaneous TCP connection per group to events.berkeley.edu. A wide fan-out is the
 * most likely way to *cause* upstream rate-limiting, after which every
 * fetchGroupFeed catches its own 429 and silently returns {} — so the
 * published count looks normal while department-specific events that only
 * post to group feeds quietly vanish.
 */
function fetchAllGroupFeeds(
  limit: Limiter,
  options: FetchOptions,
): Promise<LiveWhaleGroupFeedResult[]> {
  return Promise.all(
    LIVEWHALE_GROUPS.map((group) => fetchGroupFeed(group, limit, options)),
  );
}

export interface LiveWhaleGroupFeed {
  group: string;
  parsed: Record<string, unknown>;
  ok?: boolean;
}

export interface MergedLiveWhaleFeeds {
  parsed: Record<string, unknown>;
  groupsByUid: Map<string, string[]>;
}

function eventUid(key: string, value: unknown): string | null {
  const component = value as { type?: string; uid?: unknown } | undefined;
  if (!component || component.type !== "VEVENT") return null;
  return asString(component.uid) || key;
}

/** Merge main and group calendars by VEVENT UID while retaining all groups. */
export function mergeLiveWhaleFeeds(
  mainParsed: Record<string, unknown>,
  groupFeeds: readonly LiveWhaleGroupFeed[],
): MergedLiveWhaleFeeds {
  const parsed: Record<string, unknown> = { ...mainParsed };
  const keyByUid = new Map<string, string>();
  const groupsByUidSets = new Map<string, Set<string>>();

  for (const [key, value] of Object.entries(mainParsed)) {
    const uid = eventUid(key, value);
    if (uid) keyByUid.set(uid, key);
  }

  for (const { group, parsed: groupParsed } of groupFeeds) {
    for (const [key, value] of Object.entries(groupParsed)) {
      const uid = eventUid(key, value);
      if (!uid) {
        if (!(key in parsed)) parsed[key] = value;
        continue;
      }

      const memberships = groupsByUidSets.get(uid) ?? new Set<string>();
      memberships.add(group);
      groupsByUidSets.set(uid, memberships);

      if (keyByUid.has(uid)) continue;
      if (!(key in parsed)) {
        parsed[key] = value;
        keyByUid.set(uid, key);
      }
    }
  }

  return {
    parsed,
    groupsByUid: new Map(
      [...groupsByUidSets].map(([uid, groups]) => [uid, [...groups]]),
    ),
  };
}

export async function fetchLiveWhale(
  options: FetchOptions = {},
): Promise<FetchResult> {
  // Main-feed windows and group feeds share one bounded request pool.
  const limit = createLimiter(LIVEWHALE_CONCURRENCY);
  const adapterStart = Date.now();
  const optional: FetchOptions = {
    signal: signalWithTimeout(options.signal, OPTIONAL_WORK_DEADLINE_MS),
  };
  const [main, groupResults] = await Promise.all([
    fetchMainWindows(limit, options),
    fetchAllGroupFeeds(limit, optional),
  ]);
  const { failedWindows } = main;
  const groupFeedsDegraded = groupFeedsAreDegraded(groupResults);
  const failedGroups = groupResults
    .filter((result) => !result.ok)
    .map((result) => result.group);
  if (groupFeedsDegraded) {
    console.warn(
      "[livewhale] every department group feed failed; topic assignment will carry prior group topics",
    );
  } else if (failedGroups.length > 0) {
    console.warn(
      `[livewhale] ${failedGroups.length} group feed(s) failed; their events keep prior group topics: ${failedGroups.join(", ")}`,
    );
  }

  // Merge all iCal records by UID. The main record remains authoritative, but
  // every department feed that contained it is retained as assignment input.
  const { parsed, groupsByUid } = mergeLiveWhaleFeeds(
    main.parsed,
    groupResults,
  );

  const todayIso = todayPT();
  const fetched_at = new Date().toISOString();
  const events: CanonicalEvent[] = [];
  let rawCount = 0;
  let filteredPast = 0;
  let invalid = 0;

  // First pass: collect URLs that need redirect resolution, warm the cache in
  // parallel. Ended events are dropped below, so they are not resolved.
  const urlsToPrewarm: string[] = [];
  for (const key of Object.keys(parsed)) {
    const component = parsed[key] as { type?: string };
    if (!component || component.type !== "VEVENT") continue;
    const ve = component as unknown as ExtendedVEvent;
    const times = eventTimes(ve);
    if (!times || endedBeforePT(times, todayIso)) continue;
    const url =
      asString(ve.url) || `https://events.berkeley.edu/live/events/${ve.uid}`;
    urlsToPrewarm.push(url);
  }
  // Redirect lookups get what is left of the budget, less a margin, so a
  // slow window phase does not leave them no time at all.
  const lookups: FetchOptions = {
    signal: signalWithTimeout(
      options.signal,
      Math.max(
        5_000,
        LIVEWHALE_ADAPTER_TIMEOUT_MS - 10_000 - (Date.now() - adapterStart),
      ),
    ),
  };
  await prewarmRedirectCache(urlsToPrewarm, lookups);

  for (const key of Object.keys(parsed)) {
    const component = parsed[key] as { type?: string };
    if (!component || component.type !== "VEVENT") continue;
    const ve = component as unknown as ExtendedVEvent;
    rawCount++;

    try {
      const times = eventTimes(ve);
      if (!times) {
        invalid++;
        continue;
      }
      const { start_at, end_at, all_day: allDay } = times;

      // Drop events that ended before today (PT). A multi-day event that
      // started earlier but is still running is kept.
      if (endedBeforePT(times, todayIso)) {
        filteredPast++;
        continue;
      }

      // Skip canceled/postponed events — check iCal STATUS field and title prefix.
      const icalStatus = asString(ve.status).toUpperCase();
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
        asString(ve.url) || `https://events.berkeley.edu/live/events/${ve.uid}`;
      const { slug, unit } = await unitFromUrl(url, lookups);

      const description = decodeIcalText(asString(ve.description));
      const location = decodeIcalText(asString(ve.location));
      const categoriesRaw: string[] | string | undefined = ve.categories;
      const categories = Array.isArray(categoriesRaw)
        ? categoriesRaw
        : typeof categoriesRaw === "string"
          ? [categoriesRaw]
          : [];

      const liveWhaleId = asString(ve["x-livewhale-id"]) || asString(ve.uid);

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
        livewhale_groups: groupsByUid.get(asString(ve.uid)) ?? [],
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
  return {
    events,
    rawCount,
    filteredPast,
    invalid,
    groupFeedsDegraded,
    failedGroups,
    failedWindows,
  };
}
