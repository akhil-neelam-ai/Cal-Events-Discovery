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

import type {
  CanonicalEvent,
  LegacyCalEvent,
  PublishedSource,
  SourceName,
  SourceStatus,
  StatusReport,
} from './lib/schema.js';
import { dedupeEvents } from './lib/dedupe.js';
import { projectToLegacy } from './lib/normalize.js';
import { fetchLiveWhale } from './sources/livewhale.js';

const LIVEWHALE_HEALTHY_THRESHOLD = 100;
import { fetchCallink } from './sources/callink.js';
import { fetchCalPerformances } from './sources/cal_performances.js';
import { fetchCalBears } from './sources/calbears.js';
import { fetchBampfa } from './sources/bampfa.js';
import { fetchHaas, fetchBerkeleyLaw } from './sources/tribe.js';
import { fetchSimons } from './sources/simons.js';
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

interface RecoveryState {
  fallbackSources: Set<SourceName>;
  degradedSources: Set<SourceName>;
  degradedReasons: Set<string>;
  lastGoodUsed: number;
}

const FALLBACK_POLICIES: Partial<Record<SourceName, { allowLastGood: boolean; minHealthyCount?: number }>> = {
  livewhale: { allowLastGood: true, minHealthyCount: LIVEWHALE_HEALTHY_THRESHOLD },
  callink: { allowLastGood: true },
  cal_performances: { allowLastGood: true },
  calbears: { allowLastGood: true },
  bampfa: { allowLastGood: true },
  haas: { allowLastGood: true },
  berkeley_law: { allowLastGood: true },
  simons: { allowLastGood: true },
  ehub: { allowLastGood: true },
  gemini: { allowLastGood: false },
};

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
 * events.json, filtered to today-or-future PT dates.
 */
function loadLastGoodForSource(existing: LegacyCalEvent[], source: SourceName): LegacyCalEvent[] {
  const today = todayPT();
  return existing.filter(e => e.source === source && e.date && e.date >= today);
}

function appendLastGoodEvents(
  legacy: LegacyCalEvent[],
  existing: LegacyCalEvent[],
  source: SourceName
): number {
  const lastGood = loadLastGoodForSource(existing, source);
  if (lastGood.length === 0) return 0;
  const seenIds = new Set(legacy.map(e => e.id));
  const merged = lastGood.filter(e => !seenIds.has(e.id));
  if (merged.length === 0) return 0;
  legacy.push(...merged);
  legacy.sort((a, b) => a.date.localeCompare(b.date));
  return merged.length;
}

function markRecovery(
  run: AdapterRun,
  legacy: LegacyCalEvent[],
  existing: LegacyCalEvent[],
  recovery: RecoveryState
): void {
  const policy = FALLBACK_POLICIES[run.status.name];
  const belowHealthyThreshold =
    typeof policy?.minHealthyCount === 'number' && run.status.ok && run.status.count < policy.minHealthyCount;
  const degraded = !run.status.ok || belowHealthyThreshold;
  if (!degraded) return;

  run.status.degraded = true;

  const reason = !run.status.ok
    ? `${run.status.name} failed: ${run.status.error ?? 'unknown error'}`
    : `${run.status.name} returned ${run.status.count} events (below healthy threshold ${policy?.minHealthyCount})`;
  run.status.degraded_reason = reason;
  recovery.degradedSources.add(run.status.name);
  recovery.degradedReasons.add(reason);

  if (!policy?.allowLastGood) return;
  const restored = appendLastGoodEvents(legacy, existing, run.status.name);
  if (restored > 0) {
    run.status.fallback_used = true;
    run.status.fallback_count = restored;
    recovery.fallbackSources.add(run.status.name);
    recovery.lastGoodUsed += restored;
    console.warn(
      `[orchestrator] Fallback restored ${restored} last-good ${run.status.name} events.`
    );
  }
}

async function main(): Promise<void> {
  const apiKey = process.env.API_KEY;
  const existing = loadExistingEvents();

  // All non-Gemini adapters run regardless. Gemini only if we have a key.
  const adapterPromises: Array<Promise<AdapterRun>> = [
    runAdapter('livewhale', fetchLiveWhale),
    runAdapter('callink', fetchCallink),
    runAdapter('cal_performances', fetchCalPerformances),
    runAdapter('calbears', fetchCalBears),
    runAdapter('bampfa', fetchBampfa),
    runAdapter('haas', fetchHaas),
    runAdapter('berkeley_law', fetchBerkeleyLaw),
    runAdapter('simons', fetchSimons),
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

  const recovery: RecoveryState = {
    fallbackSources: new Set<SourceName>(),
    degradedSources: new Set<SourceName>(),
    degradedReasons: new Set<string>(),
    lastGoodUsed: 0,
  };

  for (const run of runs) {
    markRecovery(run, legacy, existing.events, recovery);
  }

  // Build the source list shown in the UI
  const sourceLinks: PublishedSource[] = [
    { title: 'UC Berkeley Events (LiveWhale)', uri: 'https://events.berkeley.edu/' },
    { title: 'CalLink Student Org Events', uri: 'https://callink.berkeley.edu/events' },
    { title: 'Cal Performances', uri: 'https://calperformances.org/events/' },
    { title: 'Cal Bears Athletics', uri: 'https://calbears.com/calendar' },
    { title: 'BAMPFA Events', uri: 'https://bampfa.org/visit/calendar' },
    { title: 'Berkeley Haas Events', uri: 'https://haas.berkeley.edu/events/' },
    { title: 'Berkeley Law Events', uri: 'https://www.law.berkeley.edu/events/' },
    { title: 'Simons Institute Events', uri: 'https://simons.berkeley.edu/programs-events' },
    { title: 'Berkeley E-Hub Events', uri: 'https://ehub.berkeley.edu/events/' },
    ...groundingSources,
  ];
  const uniqueSources = Array.from(new Map(sourceLinks.map(s => [s.uri, s])).values());

  // Refuse to publish an empty file on top of a healthy one.
  const allFailed = runs.every(r => !r.status.ok);
  if (legacy.length === 0) {
    if (allFailed) {
      console.error('[orchestrator] every source failed and produced 0 events. Keeping existing events.json.');
      writeStatus(runs, existing.events.length, duplicatesRemoved, recovery, true, 'all sources failed');
      console.error(`[orchestrator] existing file preserved (${existing.events.length} events)`);
      process.exit(1);
    } else {
      console.error('[orchestrator] sources ran but produced 0 events. Refusing to overwrite events.json.');
      writeStatus(runs, existing.events.length, duplicatesRemoved, recovery, true, 'sources produced 0 events');
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

  writeStatus(runs, legacy.length, duplicatesRemoved, recovery);
}

function writeStatus(
  runs: AdapterRun[],
  totalEvents: number,
  duplicatesRemoved: number,
  recovery: RecoveryState,
  publishFallbackUsed = false,
  publishFallbackReason?: string
): void {
  const fallbackSources = Array.from(recovery.fallbackSources);
  const degradedSources = Array.from(recovery.degradedSources);
  const degradedReasons = Array.from(recovery.degradedReasons);
  if (publishFallbackReason) degradedReasons.push(publishFallbackReason);

  const report: StatusReport = {
    generated_at: new Date().toISOString(),
    total_events: totalEvents,
    duplicates_removed: duplicatesRemoved,
    past_events_filtered: runs.reduce((s, r) => s + r.filteredPast, 0),
    invalid_events_filtered: runs.reduce((s, r) => s + r.invalid, 0),
    sources: runs.map(r => r.status),
    fallback_used: publishFallbackUsed || fallbackSources.length > 0,
    degraded: degradedSources.length > 0 || publishFallbackUsed || degradedReasons.length > 0,
    degraded_reason: degradedReasons.length > 0 ? Array.from(new Set(degradedReasons)).join('; ') : undefined,
    last_good_used: recovery.lastGoodUsed,
    fallback_sources: fallbackSources,
    degraded_sources: degradedSources,
  };
  fs.writeFileSync(statusOutPath, JSON.stringify(report, null, 2));
  console.log(`[orchestrator] wrote status report → ${statusOutPath}`);
}

main().catch(err => {
  console.error('[orchestrator] fatal:', err);
  process.exit(1);
});
