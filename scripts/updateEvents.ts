/**
 * Orchestrator: pull from every source adapter in parallel, dedupe, project
 * to the legacy CalEvent shape, write public/events.json + public/status.json.
 *
 * Source priority (configured in scripts/lib/dedupe.ts):
 *   livewhale        (structured iCal, official campus calendar) >
 *   callink          (CampusGroups JSON API, student org events) =
 *   cal_performances (WP REST API, arts presenter) =
 *   calbears         (athletics iCal) =
 *   bampfa           (HTML scraper, art museum & film archive)
 *   ai_risk          (JS schedule scrape, Berkeley AI Risk speaker series)
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
import { PublishedEventsPayloadSchema } from "./lib/schema.js";
import type { FetchOptions } from "./lib/abort.js";
import { dedupeEvents } from "./lib/dedupe.js";
import { collapseMultiDay } from "./lib/collapseMultiDay.js";
import { projectToLegacy, todayPT } from "./lib/normalize.js";
import { atomicWriteJsonSync } from "./lib/atomicWrite.js";
import {
  CRITICAL_SOURCES,
  parseMaxFallbackAgeHours,
} from "./lib/feedHealthPolicy.js";
import {
  CANCELED_TITLE_PATTERN,
  appendLastGoodEvents,
} from "./lib/lastGoodFallback.js";
import { fetchLiveWhale } from "./sources/livewhale.js";

const LIVEWHALE_HEALTHY_THRESHOLD = 100;
import { fetchCallink } from "./sources/callink.js";
import { fetchCalPerformances } from "./sources/cal_performances.js";
import { fetchCalBears } from "./sources/calbears.js";
import { fetchBampfa } from "./sources/bampfa.js";
import {
  fetchHaas,
  fetchBerkeleyLaw,
  fetchBegin,
  fetchBrsl,
} from "./sources/tribe.js";
import { fetchSimons } from "./sources/simons.js";
import { fetchLuma } from "./sources/luma.js";
import { fetchAiRisk } from "./sources/ai_risk.js";
import { buildSearchIndex } from "./lib/buildIndex.js";
import { assignTopics, TOPIC_VOCABULARY } from "./lib/topics.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const eventsOutPath = path.join(__dirname, "..", "public", "events.json");
const statusOutPath = path.join(__dirname, "..", "public", "status.json");
const indexOutPath = path.join(__dirname, "..", "public", "search-index.json");
const ADAPTER_TIMEOUT_MS = 60_000;
// Per-source hard ceiling. A flooding or broken source must not starve the
// search index or balloon committed artifacts. livewhale legitimately returns
// ~1.3k events, so this is generous headroom; truncation marks the source
// degraded so the overflow is visible in status.json.
const MAX_EVENTS_PER_SOURCE = 5000;

const MAX_FALLBACK_AGE_HOURS = parseMaxFallbackAgeHours(
  process.env.MAX_FALLBACK_AGE_HOURS,
);
const STRICT_DATA_QUALITY = /^(1|true|yes)$/i.test(
  process.env.STRICT_DATA_QUALITY ?? "",
);
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
  /** Sources whose last-good data was too old to republish, so it was dropped. */
  staleFallbackSources: Set<SourceName>;
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
  luma: { allowLastGood: true, degradeOnFailure: false, minHealthyCount: 1 },
  begin: { allowLastGood: true, degradeOnFailure: false, minHealthyCount: 1 },
  ai_risk: { allowLastGood: true, degradeOnFailure: false, minHealthyCount: 1 },
  brsl: { allowLastGood: true, degradeOnFailure: false, minHealthyCount: 1 },
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
  today: string,
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

  // Expired last-good data must never be republished as if it were fresh, but
  // that is this source's problem alone. Drop its events and keep going: a
  // supplementary feed sitting on stale fallback should cost us that feed, not
  // the fresh events every other source just returned. Only a critical source
  // in this state blocks the publish (see dataQualityFailure).
  const ageHours = fallbackAgeHours(existing.lastUpdated);
  if (typeof ageHours === "number" && ageHours > MAX_FALLBACK_AGE_HOURS) {
    const staleReason = `${run.status.name} fallback expired (${ageHours}h old, exceeding ${MAX_FALLBACK_AGE_HOURS}h); last-good events dropped`;
    run.status.fallback_expired = true;
    run.status.fallback_age_hours = ageHours;
    run.status.degraded_reason = `${reason}; ${staleReason}`;
    recovery.staleFallbackSources.add(run.status.name);
    recovery.degradedReasons.add(staleReason);
    console.warn(`[orchestrator] ${staleReason}`);
    return;
  }

  const restored = appendLastGoodEvents(
    legacy,
    existing.events,
    run.status.name,
    today,
  );
  if (restored > 0) {
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
 * rejecting) so the orchestrator's Promise.allSettled can map each result
 * back to its source name by index and one timeout cannot cancel the others.
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

/**
 * Truncate any source whose event count exceeds the per-source ceiling and
 * mark it degraded. Returns the reason per capped source so the orchestrator
 * can surface it in the top-level degraded_sources list.
 */
function capSourceEvents(runs: AdapterRun[]): Map<SourceName, string> {
  const cappedReasons = new Map<SourceName, string>();
  for (const run of runs) {
    if (run.events.length > MAX_EVENTS_PER_SOURCE) {
      const original = run.events.length;
      run.events = run.events.slice(0, MAX_EVENTS_PER_SOURCE);
      const reason = `${run.status.name} returned ${original} events, capped at ${MAX_EVENTS_PER_SOURCE} (dropped ${original - MAX_EVENTS_PER_SOURCE})`;
      run.status.degraded = true;
      run.status.degraded_reason = reason;
      run.status.count = MAX_EVENTS_PER_SOURCE;
      cappedReasons.set(run.status.name, reason);
      console.warn(`[orchestrator] ${reason}`);
    }
  }
  return cappedReasons;
}

function dataQualityFailure(recovery: RecoveryState): string | null {
  // Expired fallback on a CRITICAL source blocks publishing even when
  // STRICT_DATA_QUALITY is unset: livewhale is the backbone of the feed, so
  // losing it with no usable last-good copy leaves nothing worth shipping.
  // Supplementary sources in the same state were already dropped individually
  // in markRecovery — they must not veto the other sources' fresh events.
  const criticalStale = Array.from(recovery.staleFallbackSources).filter(
    (source) => CRITICAL_SOURCES.has(source),
  );
  if (criticalStale.length > 0) {
    return `critical source(s) on fallback older than ${MAX_FALLBACK_AGE_HOURS}h: ${criticalStale.join(", ")}`;
  }

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
      { name: "luma", promise: runAdapterWithTimeout("luma", fetchLuma) },
      { name: "begin", promise: runAdapterWithTimeout("begin", fetchBegin) },
      {
        name: "ai_risk",
        promise: runAdapterWithTimeout("ai_risk", fetchAiRisk),
      },
      { name: "brsl", promise: runAdapterWithTimeout("brsl", fetchBrsl) },
    ];

  const settledRuns = await Promise.allSettled(
    adapterRuns.map(({ promise }) => promise),
  );
  const runs: AdapterRun[] = settledRuns.map((result, index) => {
    if (result.status === "fulfilled") {
      return result.value;
    }

    const entry = adapterRuns[index];
    if (!entry) {
      // settledRuns is 1:1 with adapterRuns, so this cannot happen. Fail loudly
      // rather than silently mislabel a rejection to the wrong source.
      throw new Error(
        `[orchestrator] settled run at index ${index} has no matching adapter entry`,
      );
    }
    const name = entry.name;
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

  const cappedReasons = capSourceEvents(runs);

  const allCanonical: CanonicalEvent[] = runs.flatMap((r) => r.events);
  const groundingSources: PublishedSource[] = runs.flatMap(
    (r) => r.groundingSources ?? [],
  );

  console.log(
    `\n[orchestrator] collected ${allCanonical.length} events across ${runs.length} sources`,
  );

  // Collapse per-day rows (e.g. LiveWhale exhibits published one VEVENT per day)
  // into single multi-day events before deduping across sources.
  const {
    events: collapsed,
    rowsEliminated,
    multiDayEvents,
  } = collapseMultiDay(allCanonical);
  if (rowsEliminated > 0) {
    console.log(
      `[orchestrator] collapsed ${rowsEliminated} per-day rows into ${multiDayEvents} multi-day events`,
    );
  }

  const { events: deduped, duplicatesRemoved } = dedupeEvents(collapsed);
  console.log(
    `[orchestrator] dedupe removed ${duplicatesRemoved}, ${deduped.length} unique`,
  );

  // Strip canceled/postponed/rescheduled events from all sources. The same
  // pattern is applied inside loadLastGoodForSource so a cancellation can't
  // resurface via the fallback path on the next day the source flakes.
  const beforeCancel = deduped.length;
  const active = deduped.filter((e) => !CANCELED_TITLE_PATTERN.test(e.title));
  if (beforeCancel !== active.length) {
    console.log(
      `[orchestrator] removed ${beforeCancel - active.length} canceled/postponed events`,
    );
  }

  // Sort by date ascending
  active.sort((a, b) => a.start_at.localeCompare(b.start_at));

  // Project to legacy shape
  const legacy: LegacyCalEvent[] = active.map((event) => ({
    ...projectToLegacy(event),
    topics: assignTopics(event),
  }));

  const recovery: RecoveryState = {
    fallbackSources: new Set<SourceName>(),
    degradedSources: new Set<SourceName>(),
    staleFallbackSources: new Set<SourceName>(),
    degradedReasons: new Set<string>(),
    lastGoodUsed: 0,
  };

  const today = todayPT();
  for (const run of runs) {
    markRecovery(run, legacy, existing, recovery, today);
  }
  for (const [name, reason] of cappedReasons) {
    recovery.degradedSources.add(name);
    recovery.degradedReasons.add(reason);
  }
  // Fallback rows are already in legacy form and never passed through the
  // canonical projection above. Assign them from their published text so the
  // per-event topics contract remains consistent on degraded source days.
  for (const event of legacy) {
    event.topics ??= assignTopics(event);
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
    { title: "Luma Berkeley Events", uri: "https://luma.com/discover" },
    {
      title: "Berkeley Gateway to Innovation Events",
      uri: "https://begin.berkeley.edu/events/",
    },
    {
      title: "Berkeley AI Risk Speaker Series",
      uri: "https://ai-risk.berkeley.edu/speaker-series.html",
    },
    {
      title: "Berkeley Risk and Security Lab Events",
      uri: "https://brsl.berkeley.edu/events/",
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

  const outputData = PublishedEventsPayloadSchema.parse({
    events: legacy,
    sources: uniqueSources,
    lastUpdated: Date.now(),
    data_age_hours: dataAgeHours,
    degraded_sources: degradedSourceList,
    topic_vocabulary: TOPIC_VOCABULARY,
  });
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
  const staleFallbackSources = Array.from(recovery.staleFallbackSources);
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
    stale_fallback_sources: staleFallbackSources,
  };
  atomicWriteJsonSync(statusOutPath, report, 2);
  console.log(`[orchestrator] wrote status report → ${statusOutPath}`);
}

main().catch((err) => {
  console.error("[orchestrator] fatal:", err);
  process.exit(1);
});
