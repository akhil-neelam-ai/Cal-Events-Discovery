/**
 * Last-good fallback helpers for the publish pipeline.
 *
 * When a source is degraded and `allowLastGood: true`, the orchestrator
 * restores yesterday's events for that source from the previously-published
 * events.json. Two invariants the filter must hold:
 *
 *  1. Don't drop multi-day exhibits whose earliest day is already past but
 *     whose `end_date` / `dates[]` are still in the future. A "earliest-date
 *     only" filter silently loses months-long BAMPFA exhibits and semester
 *     lecture series — exactly the events the fallback is supposed to keep
 *     visible.
 *
 *  2. Don't re-publish events the live source has already marked canceled.
 *     If the same regex that strips "Canceled: <title>" from the freshly-
 *     deduped set is not applied to the last-good restore, a cancellation on
 *     day N+1 is silently undone whenever the source flakes on day N+2.
 */

import type { LegacyCalEvent, SourceName, SourceStatus } from "./schema.js";

/**
 * Titles that begin with any of these markers are dropped on both the live
 * dedupe path and the last-good restore path. Sources upstream of us (Tribe,
 * LiveWhale, CallLink) signal cancellation/postponement by prefixing the
 * title rather than removing the event; we treat both as "not happening".
 */
export const CANCELED_TITLE_PATTERN =
  /^(canceled|cancelled|postponed|rescheduled)[:\s]/i;

export function isValidDateKey(dateKey: string): boolean {
  const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;

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
 * True when a published event still has at least one in-progress or future
 * occurrence on the PT calendar. Single-day events expose only `date`;
 * multi-day events also expose `end_date` (last occurrence) and `dates[]`
 * (every upcoming occurrence day).
 */
export function hasFutureOccurrence(
  event: Pick<LegacyCalEvent, "date" | "end_date" | "dates">,
  today: string,
): boolean {
  if (isValidDateKey(event.date) && event.date >= today) return true;
  if (
    event.end_date &&
    isValidDateKey(event.end_date) &&
    event.end_date >= today
  ) {
    return true;
  }
  if (event.dates) {
    for (const d of event.dates) {
      if (isValidDateKey(d) && d >= today) return true;
    }
  }
  return false;
}

/**
 * Pull last-good events for `source` from the previously-published events
 * list. Filters out events whose every occurrence is past, and events whose
 * title was prefixed with a cancel marker upstream.
 */
export function loadLastGoodForSource(
  existing: LegacyCalEvent[],
  source: SourceName,
  today: string,
): LegacyCalEvent[] {
  return existing.filter(
    (e) =>
      e.source === source &&
      hasFutureOccurrence(e, today) &&
      !CANCELED_TITLE_PATTERN.test(e.title),
  );
}

/**
 * Append last-good events for `source` into `legacy`, deduping by id against
 * what's already present. Returns the number of events restored. Caller is
 * responsible for the final sort across the merged set (the orchestrator
 * already does `legacy.sort(compareLegacyEvents)` after running this for
 * every degraded source).
 */
export function appendLastGoodEvents(
  legacy: LegacyCalEvent[],
  existing: LegacyCalEvent[],
  source: SourceName,
  today: string,
): number {
  const lastGood = loadLastGoodForSource(existing, source, today);
  if (lastGood.length === 0) return 0;
  const seenIds = new Set(legacy.map((e) => e.id));
  const merged = lastGood.filter((e) => !seenIds.has(e.id));
  if (merged.length === 0) return 0;
  legacy.push(...merged);
  return merged.length;
}

/**
 * When a source last returned a healthy fetch, published as
 * `last_healthy_at` in status.json. A healthy run stamps its own fetch time.
 * A degraded run carries the previous stamp forward, so a multi-day outage
 * keeps counting from the last good day instead of from yesterday's publish.
 * Before any stamp exists, the previous publish time stands in.
 */
export function nextLastHealthyAt(
  healthy: boolean,
  fetchedAt: string,
  previousStamp: string | undefined,
  previousPublishedAt: number | undefined,
): string | undefined {
  if (healthy) return fetchedAt;
  if (previousStamp) return previousStamp;
  return previousPublishedAt
    ? new Date(previousPublishedAt).toISOString()
    : undefined;
}

/**
 * Daily runs in a row whose fetch failed. A zero-event run is not a failure,
 * because some sources are empty between terms.
 */
export function nextConsecutiveFailures(
  ok: boolean,
  previous: number | undefined,
): number {
  return ok ? 0 : (previous ?? 0) + 1;
}

/** Hours since an ISO timestamp, to one decimal place. */
export function fallbackAgeHours(
  since: string | undefined,
  now = Date.now(),
): number | undefined {
  if (!since) return undefined;
  const age = (now - Date.parse(since)) / 3_600_000;
  return Number.isFinite(age) && age >= 0
    ? Math.round(age * 10) / 10
    : undefined;
}

export interface RecoveryPolicy {
  allowLastGood: boolean;
  /**
   * True raises the visitor-facing flags when the source fails:
   * `degraded_sources`, the top-level degraded reason, and `data_age_hours`.
   * False keeps the failure quiet. The source still restores last-good
   * events and records the failure in its own status entry.
   */
  degradeOnFailure: boolean;
  minHealthyCount?: number;
}

const LIVEWHALE_HEALTHY_THRESHOLD = 100;

export const FALLBACK_POLICIES: Partial<Record<SourceName, RecoveryPolicy>> = {
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

export interface RecoveryState {
  fallbackSources: Set<SourceName>;
  degradedSources: Set<SourceName>;
  /** Sources whose last-good data was too old to republish, so it was dropped. */
  staleFallbackSources: Set<SourceName>;
  degradedReasons: Set<string>;
  lastGoodUsed: number;
  fallbackAgeHours?: number;
  restoredIds: Set<string>;
}

export function emptyRecoveryState(): RecoveryState {
  return {
    fallbackSources: new Set(),
    degradedSources: new Set(),
    staleFallbackSources: new Set(),
    degradedReasons: new Set(),
    lastGoodUsed: 0,
    restoredIds: new Set(),
  };
}

/** The health fields a run carries forward from the previous status.json. */
export type PreviousSourceHealth = Pick<
  SourceStatus,
  "last_healthy_at" | "consecutive_failures"
>;

export interface RecoveryContext {
  /** Today's published rows. Restored rows are appended in place. */
  legacy: LegacyCalEvent[];
  existing: { events: LegacyCalEvent[]; lastUpdated?: number };
  previousHealth: ReadonlyMap<string, PreviousSourceHealth>;
  recovery: RecoveryState;
  today: string;
  maxFallbackAgeHours: number;
}

/**
 * Stamps a source's health, and on failure restores its last-good events.
 * A loud source (`degradeOnFailure`) also raises the visitor-facing flags.
 */
export function markRecovery(
  status: SourceStatus,
  policy: RecoveryPolicy | undefined,
  ctx: RecoveryContext,
): void {
  const { legacy, existing, recovery } = ctx;
  const belowHealthyThreshold =
    typeof policy?.minHealthyCount === "number" &&
    status.ok &&
    status.count < policy.minHealthyCount;
  const degraded = !status.ok || belowHealthyThreshold;
  const previous = ctx.previousHealth.get(status.name);
  status.last_healthy_at = nextLastHealthyAt(
    !degraded,
    status.fetched_at,
    previous?.last_healthy_at,
    existing.lastUpdated,
  );
  status.consecutive_failures = nextConsecutiveFailures(
    status.ok,
    previous?.consecutive_failures,
  );
  if (!degraded || !policy) return;

  const reason = !status.ok
    ? `${status.name} failed: ${status.error ?? "unknown error"}`
    : `${status.name} returned ${status.count} events (below healthy threshold ${policy.minHealthyCount})`;
  status.degraded = true;
  status.degraded_reason = reason;
  if (policy.degradeOnFailure) {
    recovery.degradedSources.add(status.name);
    recovery.degradedReasons.add(reason);
  }

  if (!policy.allowLastGood) return;

  // Expired last-good data must never be republished as if it were fresh, but
  // that is this source's problem alone. Drop its events and keep going: a
  // supplementary feed sitting on stale fallback should cost us that feed, not
  // the fresh events every other source just returned. Only a critical source
  // in this state blocks the publish (see dataQualityFailure).
  // Age counts from this source's last healthy fetch. The previous publish
  // time would reset to a day old on every run of a multi-day outage.
  const ageHours = fallbackAgeHours(status.last_healthy_at);
  if (typeof ageHours === "number" && ageHours > ctx.maxFallbackAgeHours) {
    const staleReason = `${status.name} fallback expired (${ageHours}h old, exceeding ${ctx.maxFallbackAgeHours}h); last-good events dropped`;
    status.fallback_expired = true;
    status.fallback_age_hours = ageHours;
    status.degraded_reason = `${reason}; ${staleReason}`;
    recovery.staleFallbackSources.add(status.name);
    if (policy.degradeOnFailure) recovery.degradedReasons.add(staleReason);
    console.warn(`[orchestrator] ${staleReason}`);
    return;
  }

  const beforeIds = new Set(legacy.map((event) => event.id));
  const restored = appendLastGoodEvents(
    legacy,
    existing.events,
    status.name,
    ctx.today,
  );
  if (restored > 0) {
    for (const event of legacy) {
      if (!beforeIds.has(event.id)) {
        recovery.restoredIds.add(event.id);
      }
    }
    status.fallback_used = true;
    status.fallback_count = restored;
    status.fallback_age_hours = ageHours;
    recovery.fallbackSources.add(status.name);
    recovery.lastGoodUsed += restored;
    // `data_age_hours` alone raises the stale banner past 12 hours, so a
    // quiet source's handful of restored rows must not age the whole feed.
    if (policy.degradeOnFailure && typeof ageHours === "number") {
      recovery.fallbackAgeHours =
        typeof recovery.fallbackAgeHours === "number"
          ? Math.max(recovery.fallbackAgeHours, ageHours)
          : ageHours;
    }
    console.warn(
      `[orchestrator] Fallback restored ${restored} last-good ${status.name} events.`,
    );
  }
}
