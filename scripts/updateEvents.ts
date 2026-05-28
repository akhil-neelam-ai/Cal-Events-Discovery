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
 *   ehub             (HTML scraper, entrepreneurship hub)
 *
 * Failure handling: each source is independent. If a source throws, we
 * record it in status.json and continue. We refuse to overwrite a healthy
 * events.json with an empty file — if every source returns zero, we keep
 * the existing file and exit non-zero so the workflow surfaces the regression.
 *
 * Run: npx tsx scripts/updateEvents.ts
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

import type {
  CanonicalEvent,
  LegacyCalEvent,
  PublishedSource,
  SourceName,
  SourceStatus,
  StatusReport,
} from "./lib/schema.js";
import type { FetchOptions } from "./lib/abort.js";
import { dedupeEvents } from "./lib/dedupe.js";
import { projectToLegacy } from "./lib/normalize.js";
import { atomicWriteJsonSync } from "./lib/atomicWrite.js";
import { fetchLiveWhale } from "./sources/livewhale.js";

const LIVEWHALE_HEALTHY_THRESHOLD = 100;
import { fetchCallink } from "./sources/callink.js";
import { fetchCalPerformances } from "./sources/cal_performances.js";
import { fetchCalBears } from "./sources/calbears.js";
import { fetchBampfa } from "./sources/bampfa.js";
import { fetchHaas, fetchBerkeleyLaw, fetchBegin } from "./sources/tribe.js";
import { fetchSimons } from "./sources/simons.js";
import { fetchEHub } from "./sources/ehub.js";
import { fetchLuma } from "./sources/luma.js";
import { buildSearchIndex } from "./lib/buildIndex.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const eventsOutPath = path.join(__dirname, "..", "public", "events.json");
const statusOutPath = path.join(__dirname, "..", "public", "status.json");
const indexOutPath = path.join(__dirname, "..", "public", "search-index.json");
const ADAPTER_TIMEOUT_MS = 60_000;
function parseMaxFallbackAgeHours(value: string | undefined): number {
  const parsed = Number(value ?? 48);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(
      `MAX_FALLBACK_AGE_HOURS must be a non-negative number, got ${JSON.stringify(value)}`,
    );
  }
  return parsed;
}

const MAX_FALLBACK_AGE_HOURS = parseMaxFallbackAgeHours(
  process.env.MAX_FALLBACK_AGE_HOURS,
);
const STRICT_DATA_QUALITY = /^(1|true|yes)$/i.test(
  process.env.STRICT_DATA_QUALITY ?? "",
);
const ALL_SOURCE_NAMES: SourceName[] = [
  "livewhale",
  "callink",
  "cal_performances",
  "calbears",
  "bampfa",
  "haas",
  "berkeley_law",
  "simons",
  "ehub",
  "luma",
  "begin",
];
const CRITICAL_SOURCES = new Set<SourceName>(ALL_SOURCE_NAMES);

function legacyTimeSortValue(time: string | undefined): number {
  if (!time || /all\s*day/i.test(time)) {
    return 0;
  }

  const match = time.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (!match) {
    return Number.MAX_SAFE_INTEGER;
  }

  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridiem = match[3].toLowerCase();

  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) {
    return Number.MAX_SAFE_INTEGER;
  }

  if (meridiem === "am" && hour === 12) {
    hour = 0;
  } else if (meridiem === "pm" && hour !== 12) {
    hour += 12;
  }

  return hour * 60 + minute;
}

function compareLegacyEvents(
  left: LegacyCalEvent,
  right: LegacyCalEvent,
): number {
  return (
    left.date.localeCompare(right.date) ||
    legacyTimeSortValue(left.time) - legacyTimeSortValue(right.time) ||
    left.title.localeCompare(right.title) ||
    left.id.localeCompare(right.id)
  );
}

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
  fallbackAgeHours?: number;
}

interface RecoveryPolicy {
  allowLastGood: boolean;
  degradeOnFailure: boolean;
  minHealthyCount?: number;
}

const FALLBACK_POLICIES: Partial<Record<SourceName, RecoveryPolicy>> = {
  livewhale: {
    allowLastGood: true,
    degradeOnFailure: true,
    minHealthyCount: LIVEWHALE_HEALTHY_THRESHOLD,
  },
  callink: { allowLastGood: true, degradeOnFailure: true, minHealthyCount: 1 },
  cal_performances: {
    allowLastGood: true,
    degradeOnFailure: true,
    minHealthyCount: 1,
  },
  calbears: { allowLastGood: true, degradeOnFailure: true, minHealthyCount: 1 },
  bampfa: { allowLastGood: true, degradeOnFailure: true, minHealthyCount: 1 },
  haas: { allowLastGood: true, degradeOnFailure: true, minHealthyCount: 1 },
  berkeley_law: {
    allowLastGood: true,
    degradeOnFailure: true,
    minHealthyCount: 1,
  },
  simons: { allowLastGood: true, degradeOnFailure: true, minHealthyCount: 1 },
  ehub: { allowLastGood: true, degradeOnFailure: true, minHealthyCount: 1 },
  luma: { allowLastGood: true, degradeOnFailure: false, minHealthyCount: 1 },
  begin: { allowLastGood: true, degradeOnFailure: false, minHealthyCount: 1 },
};

async function runAdapter<
  T extends {
    events: CanonicalEvent[];
    groundingSources?: PublishedSource[];
    filteredPast?: number;
    invalid?: number;
  },
>(name: SourceStatus["name"], fn: () => Promise<T>): Promise<AdapterRun> {
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

function loadExistingEvents(): {
  events: LegacyCalEvent[];
  sources: PublishedSource[];
  lastUpdated?: number;
} {
  try {
    const raw = fs.readFileSync(eventsOutPath, "utf-8");
    const data = JSON.parse(raw);
    return {
      events: data.events || [],
      sources: data.sources || [],
      lastUpdated:
        typeof data.lastUpdated === "number" ? data.lastUpdated : undefined,
    };
  } catch {
    return { events: [], sources: [] };
  }
}

function todayPT(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function isValidDateKey(dateKey: string): boolean {
  const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

/**
 * Pull last-good events for a given source from the previously-published
 * events.json, filtered to today-or-future PT dates.
 */
function loadLastGoodForSource(
  existing: LegacyCalEvent[],
  source: SourceName,
): LegacyCalEvent[] {
  const today = todayPT();
  return existing.filter(
    (e) => e.source === source && isValidDateKey(e.date) && e.date >= today,
  );
}

function appendLastGoodEvents(
  legacy: LegacyCalEvent[],
  existing: LegacyCalEvent[],
  source: SourceName,
): number {
  const lastGood = loadLastGoodForSource(existing, source);
  if (lastGood.length === 0) return 0;
  const seenIds = new Set(legacy.map((e) => e.id));
  const merged = lastGood.filter((e) => !seenIds.has(e.id));
  if (merged.length === 0) return 0;
  legacy.push(...merged);
  legacy.sort(compareLegacyEvents);
  return merged.length;
}

function fallbackAgeHours(lastUpdated: number | undefined): number | undefined {
  if (!lastUpdated) return undefined;
  const age = (Date.now() - lastUpdated) / 3_600_000;
  return Number.isFinite(age) && age >= 0
    ? Math.round(age * 10) / 10
    : undefined;
}

function markRecovery(
  run: AdapterRun,
  legacy: LegacyCalEvent[],
  existing: { events: LegacyCalEvent[]; lastUpdated?: number },
  recovery: RecoveryState,
): void {
  const policy = FALLBACK_POLICIES[run.status.name];
  const belowHealthyThreshold =
    typeof policy?.minHealthyCount === "number" &&
    run.status.ok &&
    run.status.count < policy.minHealthyCount;
  const degraded = !run.status.ok || belowHealthyThreshold;
  if (!degraded) return;

  if (!policy?.degradeOnFailure) {
    return;
  }

  run.status.degraded = true;

  const reason = !run.status.ok
    ? `${run.status.name} failed: ${run.status.error ?? "unknown error"}`
    : `${run.status.name} returned ${run.status.count} events (below healthy threshold ${policy?.minHealthyCount})`;
  run.status.degraded_reason = reason;
  recovery.degradedSources.add(run.status.name);
  recovery.degradedReasons.add(reason);

  if (!policy?.allowLastGood) return;
  const restored = appendLastGoodEvents(
    legacy,
    existing.events,
    run.status.name,
  );
  if (restored > 0) {
    const ageHours = fallbackAgeHours(existing.lastUpdated);
    run.status.fallback_used = true;
    run.status.fallback_count = restored;
    run.status.fallback_age_hours = ageHours;
    recovery.fallbackSources.add(run.status.name);
    recovery.lastGoodUsed += restored;
    if (typeof ageHours === "number") {
      recovery.fallbackAgeHours =
        typeof recovery.fallbackAgeHours === "number"
          ? Math.max(recovery.fallbackAgeHours, ageHours)
          : ageHours;
    }
    console.warn(
      `[orchestrator] Fallback restored ${restored} last-good ${run.status.name} events.`,
    );
  }
}

/**
 * Run an adapter with a hard timeout, returning a failed AdapterRun (never
 * rejecting) so Promise.all can be used and the source name is always preserved.
 */
function runAdapterWithTimeout(
  name: SourceName,
  fn: (options: FetchOptions) => Promise<{ events: CanonicalEvent[] }>,
): Promise<AdapterRun> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(
        `${name} timed out after ${ADAPTER_TIMEOUT_MS}ms`,
      );
      controller.abort(error);
      reject(error);
    }, ADAPTER_TIMEOUT_MS);
  });

  return Promise.race([
    runAdapter(name, () => fn({ signal: controller.signal })),
    timeout,
  ])
    .catch((err): AdapterRun => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[orchestrator] ${name} failed: ${message}`);
      return {
        status: {
          name,
          ok: false,
          count: 0,
          duration_ms: ADAPTER_TIMEOUT_MS,
          error: message,
          fetched_at: new Date().toISOString(),
        },
        events: [],
        filteredPast: 0,
        invalid: 0,
      };
    })
    .finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
    });
}

function dataQualityFailure(recovery: RecoveryState): string | null {
  if (!STRICT_DATA_QUALITY) return null;

  const criticalDegraded = Array.from(recovery.degradedSources).filter(
    (source) => CRITICAL_SOURCES.has(source),
  );
  if (criticalDegraded.length === 0) return null;

  const degradedWithoutFallback = criticalDegraded.filter(
    (source) => !recovery.fallbackSources.has(source),
  );
  if (degradedWithoutFallback.length > 0) {
    return `critical source(s) degraded without fallback: ${degradedWithoutFallback.join(", ")}`;
  }

  if (
    recovery.fallbackSources.size > 0 &&
    typeof recovery.fallbackAgeHours !== "number"
  ) {
    return "fallback data age is unknown";
  }

  if (
    typeof recovery.fallbackAgeHours === "number" &&
    recovery.fallbackAgeHours > MAX_FALLBACK_AGE_HOURS
  ) {
    return `fallback data is ${recovery.fallbackAgeHours}h old, exceeding ${MAX_FALLBACK_AGE_HOURS}h`;
  }

  return null;
}

async function main(): Promise<void> {
  const existing = loadExistingEvents();

  // Each adapter is wrapped in a 60 s timeout so a hanging source cannot
  // block the entire pipeline. Promise.allSettled ensures one timeout does
  // not cancel the others.
  const adapterRuns: Array<{ name: SourceName; promise: Promise<AdapterRun> }> =
    [
      {
        name: "livewhale",
        promise: runAdapterWithTimeout("livewhale", fetchLiveWhale),
      },
      {
        name: "callink",
        promise: runAdapterWithTimeout("callink", fetchCallink),
      },
      {
        name: "cal_performances",
        promise: runAdapterWithTimeout(
          "cal_performances",
          fetchCalPerformances,
        ),
      },
      {
        name: "calbears",
        promise: runAdapterWithTimeout("calbears", fetchCalBears),
      },
      { name: "bampfa", promise: runAdapterWithTimeout("bampfa", fetchBampfa) },
      { name: "haas", promise: runAdapterWithTimeout("haas", fetchHaas) },
      {
        name: "berkeley_law",
        promise: runAdapterWithTimeout("berkeley_law", fetchBerkeleyLaw),
      },
      { name: "simons", promise: runAdapterWithTimeout("simons", fetchSimons) },
      { name: "ehub", promise: runAdapterWithTimeout("ehub", fetchEHub) },
      { name: "luma", promise: runAdapterWithTimeout("luma", fetchLuma) },
      { name: "begin", promise: runAdapterWithTimeout("begin", fetchBegin) },
    ];

  const settledRuns = await Promise.allSettled(
    adapterRuns.map(({ promise }) => promise),
  );
  const runs: AdapterRun[] = settledRuns.map((result, index) => {
    if (result.status === "fulfilled") {
      return result.value;
    }

    const name = adapterRuns[index]?.name ?? "ehub";
    const message =
      result.reason instanceof Error
        ? result.reason.message
        : String(result.reason);
    console.error(`[orchestrator] ${name} rejected unexpectedly: ${message}`);
    return {
      status: {
        name,
        ok: false,
        count: 0,
        duration_ms: 0,
        error: `unexpected rejection: ${message}`,
        fetched_at: new Date().toISOString(),
      },
      events: [],
      filteredPast: 0,
      invalid: 0,
    };
  });

  const allCanonical: CanonicalEvent[] = runs.flatMap((r) => r.events);
  const groundingSources: PublishedSource[] = runs.flatMap(
    (r) => r.groundingSources ?? [],
  );

  console.log(
    `\n[orchestrator] collected ${allCanonical.length} events across ${runs.length} sources`,
  );

  const { events: deduped, duplicatesRemoved } = dedupeEvents(allCanonical);
  console.log(
    `[orchestrator] dedupe removed ${duplicatesRemoved}, ${deduped.length} unique`,
  );

  // Strip canceled/postponed/rescheduled events from all sources
  const canceledPattern = /^(canceled|cancelled|postponed|rescheduled)[:\s]/i;
  const beforeCancel = deduped.length;
  const active = deduped.filter((e) => !canceledPattern.test(e.title));
  if (beforeCancel !== active.length) {
    console.log(
      `[orchestrator] removed ${beforeCancel - active.length} canceled/postponed events`,
    );
  }

  // Sort by date ascending
  active.sort((a, b) => a.start_at.localeCompare(b.start_at));

  // Project to legacy shape
  const legacy: LegacyCalEvent[] = active.map(projectToLegacy);

  const recovery: RecoveryState = {
    fallbackSources: new Set<SourceName>(),
    degradedSources: new Set<SourceName>(),
    degradedReasons: new Set<string>(),
    lastGoodUsed: 0,
  };

  for (const run of runs) {
    markRecovery(run, legacy, existing, recovery);
  }
  legacy.sort(compareLegacyEvents);

  // Build the source list shown in the UI
  const sourceLinks: PublishedSource[] = [
    {
      title: "UC Berkeley Events (LiveWhale)",
      uri: "https://events.berkeley.edu/",
    },
    {
      title: "CalLink Student Org Events",
      uri: "https://callink.berkeley.edu/events",
    },
    { title: "Cal Performances", uri: "https://calperformances.org/events/" },
    { title: "Cal Bears Athletics", uri: "https://calbears.com/calendar" },
    { title: "BAMPFA Events", uri: "https://bampfa.org/visit/calendar" },
    { title: "Berkeley Haas Events", uri: "https://haas.berkeley.edu/events/" },
    {
      title: "Berkeley Law Events",
      uri: "https://www.law.berkeley.edu/events/",
    },
    {
      title: "Simons Institute Events",
      uri: "https://simons.berkeley.edu/programs-events",
    },
    {
      title: "Berkeley E-Hub Events",
      uri: "https://ehub.berkeley.edu/events/",
    },
    { title: "Luma Berkeley Events", uri: "https://luma.com/discover" },
    {
      title: "Berkeley Gateway to Innovation Events",
      uri: "https://begin.berkeley.edu/events/",
    },
    ...groundingSources,
  ];
  const uniqueSources = Array.from(
    new Map(sourceLinks.map((s) => [s.uri, s])).values(),
  );

  // Refuse to publish an empty file on top of a healthy one.
  const allFailed = runs.every((r) => !r.status.ok);
  if (legacy.length === 0) {
    if (allFailed) {
      console.error(
        "[orchestrator] every source failed and produced 0 events. Keeping existing events.json.",
      );
      writeStatus(
        runs,
        existing.events.length,
        duplicatesRemoved,
        recovery,
        true,
        "all sources failed",
      );
      console.error(
        `[orchestrator] existing file preserved (${existing.events.length} events)`,
      );
      process.exit(1);
    } else {
      console.error(
        "[orchestrator] sources ran but produced 0 events. Refusing to overwrite events.json.",
      );
      writeStatus(
        runs,
        existing.events.length,
        duplicatesRemoved,
        recovery,
        true,
        "sources produced 0 events",
      );
      process.exit(1);
    }
  }

  const qualityFailure = dataQualityFailure(recovery);
  if (qualityFailure) {
    writeStatus(
      runs,
      legacy.length,
      duplicatesRemoved,
      recovery,
      false,
      undefined,
      true,
    );
    console.error(`[orchestrator] data quality gate failed: ${qualityFailure}`);
    process.exit(1);
  }

  const dataAgeHours =
    typeof recovery.fallbackAgeHours === "number"
      ? recovery.fallbackAgeHours
      : 0;
  const degradedSourceList = Array.from(recovery.degradedSources);

  const outputData = {
    events: legacy,
    sources: uniqueSources,
    lastUpdated: Date.now(),
    data_age_hours: dataAgeHours,
    degraded_sources: degradedSourceList,
  };
  atomicWriteJsonSync(eventsOutPath, outputData, 2);
  console.log(
    `[orchestrator] wrote ${legacy.length} events → ${eventsOutPath}`,
  );

  const searchIndex = buildSearchIndex(legacy);
  atomicWriteJsonSync(indexOutPath, searchIndex);
  const stemCount = Object.keys(searchIndex.t).length;
  console.log(
    `[orchestrator] wrote search index (${stemCount} title-stems) → ${indexOutPath}`,
  );

  writeStatus(
    runs,
    legacy.length,
    duplicatesRemoved,
    recovery,
    false,
    undefined,
    false,
  );
}

function writeStatus(
  runs: AdapterRun[],
  totalEvents: number,
  duplicatesRemoved: number,
  recovery: RecoveryState,
  publishFallbackUsed = false,
  publishFallbackReason?: string,
  dataQualityBlocked = false,
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
    sources: runs.map((r) => r.status),
    fallback_used: publishFallbackUsed || fallbackSources.length > 0,
    degraded:
      degradedSources.length > 0 ||
      publishFallbackUsed ||
      degradedReasons.length > 0,
    degraded_reason:
      degradedReasons.length > 0
        ? Array.from(new Set(degradedReasons)).join("; ")
        : undefined,
    last_good_used: recovery.lastGoodUsed,
    fallback_age_hours: recovery.fallbackAgeHours,
    data_quality_blocked: dataQualityBlocked,
    fallback_sources: fallbackSources,
    degraded_sources: degradedSources,
  };
  atomicWriteJsonSync(statusOutPath, report, 2);
  console.log(`[orchestrator] wrote status report → ${statusOutPath}`);
}

main().catch((err) => {
  console.error("[orchestrator] fatal:", err);
  process.exit(1);
});
