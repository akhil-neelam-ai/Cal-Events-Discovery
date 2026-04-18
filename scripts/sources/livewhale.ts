/**
 * LiveWhale iCal adapter — primary event source.
 *
 * events.berkeley.edu runs on LiveWhale. The /live/ical/events endpoint
 * publishes the full official campus calendar (~1,500 events) as RFC 5545
 * iCalendar. Each VEVENT carries a stable LiveWhale ID, organizer slug
 * embedded in the URL, location, optional categories, and timezone-aware
 * start/end timestamps.
 */

import ical, { type VEvent } from 'node-ical';
import type { CanonicalEvent } from '../lib/schema.js';
import { CanonicalEventSchema } from '../lib/schema.js';

const FEED_URL = 'https://events.berkeley.edu/live/ical/events';
const FETCH_TIMEOUT_MS = 30_000;
const MAX_FETCH_ATTEMPTS = 3;
const EMPTY_FEED_RETRY_DELAY_MS = 1_500;
// LiveWhale occasionally returns an empty calendar payload despite a 200 response.
// Anything below this threshold is treated as a flake and retried.
const MIN_HEALTHY_EVENT_COUNT = 50;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Map known LiveWhale calendar slugs (the path segment after the host) to
 * a human-readable organizer unit. Anything missing falls back to the slug
 * itself, capitalized.
 */
const ORG_UNIT_MAP: Record<string, string> = {
  sports: 'Cal Athletics',
  ihouse: 'International House',
  calparents: 'Cal Parents',
  serc: 'Student Environmental Resource Center',
  chem: 'Department of Chemistry',
  coe: 'College of Engineering',
  cdss: 'College of Computing, Data Science, and Society',
  ischool: 'School of Information',
  law: 'Berkeley Law',
  publichealth: 'School of Public Health',
  gspp: 'Goldman School of Public Policy',
  haas: 'Berkeley Haas',
  bampfa: 'BAMPFA',
  botanicalgarden: 'UC Botanical Garden',
  bids: 'Berkeley Institute for Data Science',
  citris: 'CITRIS',
  cltc: 'Center for Long-Term Cybersecurity',
  simons: 'Simons Institute',
  scet: 'Sutardja Center for Entrepreneurship & Technology',
  blumcenter: 'Blum Center',
  ssl: 'Space Sciences Laboratory',
  rdi: 'Berkeley RDI',
  cnr: 'College of Natural Resources',
  graddiv: 'Graduate Division',
  library: 'UC Berkeley Library',
  mcb: 'Molecular & Cell Biology',
  physics: 'Department of Physics',
  math: 'Department of Mathematics',
  eecs: 'EECS',
  ce: 'Civil & Environmental Engineering',
  me: 'Mechanical Engineering',
  bioe: 'Bioengineering',
};

function unitFromUrl(url: string | undefined): { slug: string; unit: string } {
  if (!url) return { slug: '', unit: '' };
  try {
    const path = new URL(url).pathname;
    const segments = path.split('/').filter(Boolean);
    const slug = segments[0] || '';
    const unit =
      ORG_UNIT_MAP[slug] ||
      slug
        .replace(/[-_]/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
    return { slug, unit };
  } catch {
    return { slug: '', unit: '' };
  }
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'val' in (value as object)) {
    return String((value as { val: unknown }).val ?? '');
  }
  return '';
}

function isAllDay(component: VEvent): boolean {
  // node-ical sets datetype to 'date' for VALUE=DATE entries
  // (it leaves it as 'date-time' for TZID-anchored timestamps)
  const datetype = (component as unknown as { datetype?: string }).datetype;
  return datetype === 'date';
}

function isoDateUTC(d: Date): string {
  // For all-day VEVENTs node-ical returns a Date at UTC midnight; format YYYY-MM-DD
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayPT(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function decodeIcalText(text: string): string {
  return text
    .replace(/\\n/g, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .replace(/&amp;/g, '&')
    .replace(/&#160;/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface FetchResult {
  events: CanonicalEvent[];
  rawCount: number;
  filteredPast: number;
  invalid: number;
}

async function fetchFeed(): Promise<Record<string, unknown>> {
  let lastErr = '';
  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt++) {
    console.log(`[livewhale] fetching ${FEED_URL} (attempt ${attempt}/${MAX_FETCH_ATTEMPTS})`);
    try {
      const res = await fetch(FEED_URL, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { 'User-Agent': 'Cal-Events-Discovery-Bot' },
      });
      if (!res.ok) {
        lastErr = `${res.status} ${res.statusText}`;
        console.warn(`[livewhale] non-2xx (${lastErr})`);
      } else {
        const ics = await res.text();
        const parsed = ical.sync.parseICS(ics);
        const veventCount = Object.values(parsed).filter(c => (c as { type?: string }).type === 'VEVENT').length;
        if (veventCount >= MIN_HEALTHY_EVENT_COUNT) {
          return parsed;
        }
        lastErr = `empty/short feed (${veventCount} VEVENTs, need ≥ ${MIN_HEALTHY_EVENT_COUNT})`;
        console.warn(`[livewhale] ${lastErr}`);
      }
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      console.warn(`[livewhale] fetch error: ${lastErr}`);
    }
    if (attempt < MAX_FETCH_ATTEMPTS) await sleep(EMPTY_FEED_RETRY_DELAY_MS * attempt);
  }
  throw new Error(`LiveWhale fetch failed after ${MAX_FETCH_ATTEMPTS} attempts: ${lastErr}`);
}

export async function fetchLiveWhale(): Promise<FetchResult> {
  const parsed = await fetchFeed();

  const todayIso = todayPT();
  const fetched_at = new Date().toISOString();
  const events: CanonicalEvent[] = [];
  let rawCount = 0;
  let filteredPast = 0;
  let invalid = 0;

  for (const key of Object.keys(parsed)) {
    const component = parsed[key] as { type?: string };
    if (!component || component.type !== 'VEVENT') continue;
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
      const eventDate = allDay ? start_at : start_at.slice(0, 10);
      if (eventDate < todayIso) {
        filteredPast++;
        continue;
      }

      const url = asString(ve.url) || `https://events.berkeley.edu/live/events/${(ve as unknown as { uid?: string }).uid}`;
      const { slug, unit } = unitFromUrl(url);

      const summary = decodeIcalText(asString(ve.summary));
      const description = decodeIcalText(asString(ve.description));
      const location = decodeIcalText(asString(ve.location));
      const categoriesRaw = (ve as unknown as { categories?: string[] | string }).categories;
      const categories = Array.isArray(categoriesRaw)
        ? categoriesRaw
        : typeof categoriesRaw === 'string'
        ? [categoriesRaw]
        : [];

      const liveWhaleId =
        asString((ve as unknown as { ['x-livewhale-id']?: unknown })['x-livewhale-id']) ||
        asString((ve as unknown as { uid?: unknown }).uid);

      const candidate: CanonicalEvent = {
        source_name: 'livewhale',
        source_id: String(liveWhaleId),
        source_url: FEED_URL,
        evidence_url: url,
        title: summary,
        description,
        start_at,
        end_at,
        timezone: 'America/Los_Angeles',
        all_day: allDay,
        venue: location,
        building: '',
        address: '',
        modality: 'in_person',
        organizer: unit,
        organizer_unit: unit,
        audience: '',
        cost: '',
        registration_url: undefined,
        canonical_url: url,
        categories,
        tags: [],
        last_seen_at: fetched_at,
        confidence: 1,
        quality_flags: slug ? [] : ['unknown_org_slug'],
      };

      const validated = CanonicalEventSchema.safeParse(candidate);
      if (!validated.success) {
        invalid++;
        if (invalid <= 5) {
          console.warn(`[livewhale] schema reject "${summary}": ${validated.error.issues.map(i => `${i.path.join('.')}:${i.message}`).join('; ')}`);
        }
        continue;
      }
      events.push(validated.data);
    } catch (err) {
      invalid++;
      if (invalid <= 5) {
        console.warn(`[livewhale] failed to parse VEVENT: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  console.log(`[livewhale] parsed ${events.length}/${rawCount} (past: ${filteredPast}, invalid: ${invalid})`);
  return { events, rawCount, filteredPast, invalid };
}
