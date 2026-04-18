/**
 * Orchestrator: pull from every source adapter in parallel, dedupe, project
 * to the legacy CalEvent shape, write public/events.json + public/status.json.
 *
 * Source priority (configured in scripts/lib/dedupe.ts):
 *   livewhale        (structured iCal, official campus calendar) >
 *   callink          (CampusGroups JSON API, student org events) =
 *   cal_performances (WP REST API, arts presenter) =
 *   calbears         (athletics iCal) =
 *   bampfa           (HTML scraper, art museum & film archive) >
 *   ehub             (HTML scraper, entrepreneurship hub) >
 *   gemini           (LLM long-tail, lowest confidence)
 *
 * Failure handling: each source is independent. If a source throws, we
 * record it in status.json and continue. We refuse to overwrite a healthy
 * events.json with an empty file — if every source returns zero, we keep
 * the existing file and exit non-zero so the workflow surfaces the regression.
 *
 * Run: API_KEY=... npx tsx scripts/updateEvents.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import type { CanonicalEvent, LegacyCalEvent, PublishedSource, SourceStatus, StatusReport } from './lib/schema.js';
import { dedupeEvents } from './lib/dedupe.js';
import { projectToLegacy } from './lib/normalize.js';
import { fetchLiveWhale } from './sources/livewhale.js';

/** Below this many LiveWhale events we treat the run as degraded and fall back to last-good. */
const LIVEWHALE_HEALTHY_THRESHOLD = 100;
import { fetchCallink } from './sources/callink.js';
import { fetchCalPerformances } from './sources/cal_performances.js';
import { fetchCalBears } from './sources/calbears.js';
import { fetchBampfa } from './sources/bampfa.js';
import { fetchEHub } from './sources/ehub.js';
import { fetchGeminiLongTail } from './sources/gemini.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const eventsOutPath = path.join(__dirname, '..', 'public', 'events.json');
const statusOutPath = path.join(__dirname, '..', 'public', 'status.json');

interface AdapterRun {
  status: SourceStatus;
  events: CanonicalEvent[];
  groundingSources?: PublishedSource[];
  filteredPast: number;
  invalid: number;
}

async function runAdapter<T extends {
  events: CanonicalEvent[];
  groundingSources?: PublishedSource[];
  filteredPast?: number;
  invalid?: number;
}>(
  name: SourceStatus['name'],
  fn: () => Promise<T>
): Promise<AdapterRun> {
  const started = Date.now();
  const fetched_at = new Date().toISOString();
  try {
    const result = await fn();
    return {
      status: {
        name,
        ok: true,
        count: result.events.length,
        duration_ms: Date.now() - started,
        fetched_at,
      },
      events: result.events,
      groundingSources: result.groundingSources,
      filteredPast: result.filteredPast ?? 0,
      invalid: result.invalid ?? 0,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${name}] adapter failed: ${message}`);
    return {
      status: {
        name,
        ok: false,
        count: 0,
        duration_ms: Date.now() - started,
        error: message,
        fetched_at,
      },
      events: [],
      filteredPast: 0,
      invalid: 0,
    };
  }
}

function loadExistingEvents(): { events: LegacyCalEvent[]; sources: PublishedSource[] } {
  try {
    const raw = fs.readFileSync(eventsOutPath, 'utf-8');
    const data = JSON.parse(raw);
    return { events: data.events || [], sources: data.sources || [] };
  } catch {
    return { events: [], sources: [] };
  }
}

function todayPT(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * Pull last-good events for a given source from the previously-published
 * events.json, filtered to today-or-future PT dates. Used when a tier-1
 * source flakes (returns 0 or below the healthy threshold) so we don't
 * silently ship a partial corpus.
 */
function loadLastGoodForSource(source: string): LegacyCalEvent[] {
  const today = todayPT();
  const { events } = loadExistingEvents();
  return events.filter(e => e.source === source && e.date && e.date >= today);
}

async function main(): Promise<void> {
  const apiKey = process.env.API_KEY;

  // LiveWhale + CalLink + Cal Performances + Cal Bears + E-Hub run regardless. Gemini only if we have a key.
  const adapterPromises: Array<Promise<AdapterRun>> = [
    runAdapter('livewhale', fetchLiveWhale),
    runAdapter('callink', fetchCallink),
    runAdapter('cal_performances', fetchCalPerformances),
    runAdapter('calbears', fetchCalBears),
    runAdapter('bampfa', fetchBampfa),
    runAdapter('ehub', fetchEHub),
  ];
  if (apiKey) {
    adapterPromises.push(runAdapter('gemini', () => fetchGeminiLongTail(apiKey)));
  } else {
    console.warn('[orchestrator] API_KEY not set — skipping Gemini long-tail adapter');
  }

  const runs = await Promise.all(adapterPromises);

  const allCanonical: CanonicalEvent[] = runs.flatMap(r => r.events);
  const groundingSources: PublishedSource[] = runs.flatMap(r => r.groundingSources ?? []);

  console.log(`\n[orchestrator] collected ${allCanonical.length} events across ${runs.length} sources`);

  const { events: deduped, duplicatesRemoved } = dedupeEvents(allCanonical);
  console.log(`[orchestrator] dedupe removed ${duplicatesRemoved}, ${deduped.length} unique`);

  // Sort by date ascending
  deduped.sort((a, b) => a.start_at.localeCompare(b.start_at));

  // Project to legacy shape
  const legacy: LegacyCalEvent[] = deduped.map(projectToLegacy);

  // Tier-1 health check: LiveWhale is the spine of the corpus. If it failed
  // outright OR returned an implausibly low count (the 200-OK-empty-feed
  // flake), splice in the last-good LiveWhale slice from events.json so a
  // single upstream wobble doesn't drop ~75% of the catalog.
  const livewhaleRun = runs.find(r => r.status.name === 'livewhale');
  const livewhaleCount = livewhaleRun?.status.count ?? 0;
  const livewhaleDegraded =
    !livewhaleRun ||
    !livewhaleRun.status.ok ||
    livewhaleCount < LIVEWHALE_HEALTHY_THRESHOLD;

  let degraded = false;
  let degradedReason: string | undefined;
  let lastGoodUsed = 0;

  if (livewhaleDegraded) {
    const lastGood = loadLastGoodForSource('livewhale');
    if (lastGood.length > 0) {
      const seenIds = new Set(legacy.map(e => e.id));
      const merged = lastGood.filter(e => !seenIds.has(e.id));
      legacy.push(...merged);
      legacy.sort((a, b) => a.date.localeCompare(b.date));
      lastGoodUsed = merged.length;
      degraded = true;
      degradedReason = livewhaleRun?.status.ok
        ? `LiveWhale returned ${livewhaleCount} events (below healthy threshold ${LIVEWHALE_HEALTHY_THRESHOLD})`
        : `LiveWhale failed: ${livewhaleRun?.status.error ?? 'unknown error'}`;
      console.warn(
        `[orchestrator] DEGRADED — ${degradedReason}. Spliced ${merged.length} last-good LiveWhale events.`
      );
    } else {
      degraded = true;
      degradedReason = 'LiveWhale unhealthy and no last-good cache available';
      console.warn(`[orchestrator] DEGRADED — ${degradedReason}.`);
    }
  }

  // Build the source list shown in the UI
  const sourceLinks: PublishedSource[] = [
    { title: 'UC Berkeley Events (LiveWhale)', uri: 'https://events.berkeley.edu/' },
    { title: 'CalLink Student Org Events', uri: 'https://callink.berkeley.edu/events' },
    { title: 'Cal Performances', uri: 'https://calperformances.org/events/' },
    { title: 'Cal Bears Athletics', uri: 'https://calbears.com/calendar' },
    { title: 'BAMPFA Events', uri: 'https://bampfa.org/visit/calendar' },
    { title: 'Berkeley E-Hub Events', uri: 'https://ehub.berkeley.edu/events/' },
    ...groundingSources,
  ];
  const uniqueSources = Array.from(new Map(sourceLinks.map(s => [s.uri, s])).values());

  // Refuse to publish an empty file on top of a healthy one.
  const allFailed = runs.every(r => !r.status.ok);
  if (legacy.length === 0) {
    if (allFailed) {
      const existing = loadExistingEvents();
      console.error('[orchestrator] every source failed and produced 0 events. Keeping existing events.json.');
      writeStatus(runs, deduped.length, duplicatesRemoved, true, true, 'all sources failed', 0);
      console.error(`[orchestrator] existing file preserved (${existing.events.length} events)`);
      process.exit(1);
    } else {
      console.error('[orchestrator] sources ran but produced 0 events. Refusing to overwrite events.json.');
      writeStatus(runs, 0, duplicatesRemoved, true, true, 'sources produced 0 events', 0);
      process.exit(1);
    }
  }

  const outputData = {
    events: legacy,
    sources: uniqueSources,
    lastUpdated: Date.now(),
  };
  fs.writeFileSync(eventsOutPath, JSON.stringify(outputData, null, 2));
  console.log(`[orchestrator] wrote ${legacy.length} events → ${eventsOutPath}`);

  writeStatus(runs, legacy.length, duplicatesRemoved, false, degraded, degradedReason, lastGoodUsed);
}

function writeStatus(
  runs: AdapterRun[],
  totalEvents: number,
  duplicatesRemoved: number,
  fallback_used: boolean,
  degraded: boolean,
  degraded_reason: string | undefined,
  last_good_used: number
): void {
  const report: StatusReport = {
    generated_at: new Date().toISOString(),
    total_events: totalEvents,
    duplicates_removed: duplicatesRemoved,
    past_events_filtered: runs.reduce((s, r) => s + r.filteredPast, 0),
    invalid_events_filtered: runs.reduce((s, r) => s + r.invalid, 0),
    sources: runs.map(r => r.status),
    fallback_used,
    degraded,
    degraded_reason,
    last_good_used,
  };
  fs.writeFileSync(statusOutPath, JSON.stringify(report, null, 2));
  console.log(`[orchestrator] wrote status report → ${statusOutPath}`);
}

main().catch(err => {
  console.error('[orchestrator] fatal:', err);
  process.exit(1);
});
