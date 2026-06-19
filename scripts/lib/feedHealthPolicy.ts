/**
 * Shared feed-health rules for CI blocking and operator alerts.
 */

import { evaluateSourceCoverageWarnings } from "./sourceCoveragePolicy.js";

// Authoritative critical-source set, shared by the publish gate
// (scripts/updateEvents.ts) and the CI health check (scripts/checkFeedHealth.ts).
// Typed as ReadonlySet<string> so both a SourceName-keyed and a raw-string-keyed
// caller can query it.
//
// Only LiveWhale is critical. It is the official campus calendar and the backbone
// of the feed (the large majority of events); if it degrades without fallback we
// genuinely have nothing worth publishing. Every other source is supplementary:
// they are platform-capped, scraped from fragile endpoints, or naturally sparse
// between terms (e.g. callink returns zero upcoming events in summer). A single
// supplementary source going down must NOT hard-fail the daily publish — those
// degrade to last-good fallback and emit warnings instead. Correctness is still
// protected for all sources by the zero-total-events and stale-fallback blocks
// below. This replaces the previous source-by-source hotfix model (dropping
// callink for summer, etc.) with a term-agnostic rule.
export const CRITICAL_SOURCES: ReadonlySet<string> = new Set(["livewhale"]);

export function parseMaxFallbackAgeHours(
  value: string | number | undefined,
): number {
  const parsed = Number(value ?? 48);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(
      `MAX_FALLBACK_AGE_HOURS must be a non-negative number, got ${JSON.stringify(value)}`,
    );
  }
  return parsed;
}

export interface FeedHealthOptions {
  staleHours?: number;
  maxFallbackAgeHours?: number;
}

export interface FeedHealthResult {
  blocking: string[];
  warnings: string[];
}

export function evaluateFeedHealth(
  status: Record<string, unknown>,
  options: FeedHealthOptions = {},
): FeedHealthResult {
  const staleHours = Number(options.staleHours ?? 36);
  const maxFallbackAgeHours = parseMaxFallbackAgeHours(
    options.maxFallbackAgeHours,
  );
  const blocking: string[] = [];
  const warnings: string[] = [];

  if (status.data_quality_blocked === true) {
    blocking.push("data quality gate blocked publishing fresh events");
  }

  const totalEvents = Number(status.total_events ?? 0);
  if (!Number.isFinite(totalEvents) || totalEvents <= 0) {
    blocking.push("published event count is zero");
  }

  const degradedSources = Array.isArray(status.degraded_sources)
    ? status.degraded_sources.map(String)
    : [];
  const fallbackSources = new Set<string>(
    Array.isArray(status.fallback_sources)
      ? status.fallback_sources.map(String)
      : [],
  );

  const unrecoveredCritical = degradedSources.filter(
    (source) => CRITICAL_SOURCES.has(source) && !fallbackSources.has(source),
  );
  if (unrecoveredCritical.length > 0) {
    blocking.push(
      `critical source(s) degraded without fallback: ${unrecoveredCritical.join(", ")}`,
    );
  }

  const recoveredCritical = degradedSources.filter(
    (source) => CRITICAL_SOURCES.has(source) && fallbackSources.has(source),
  );
  if (recoveredCritical.length > 0) {
    warnings.push(
      `critical source(s) recovered via fallback: ${recoveredCritical.join(", ")}`,
    );
  }

  const nonCriticalDegraded = degradedSources.filter(
    (source) => !CRITICAL_SOURCES.has(source),
  );
  if (nonCriticalDegraded.length > 0) {
    warnings.push(
      `non-critical source(s) degraded: ${nonCriticalDegraded.join(", ")}`,
    );
  }

  if (status.fallback_used === true) {
    const sources = Array.isArray(status.fallback_sources)
      ? status.fallback_sources.join(", ")
      : "unknown";
    const age =
      typeof status.fallback_age_hours === "number"
        ? `${status.fallback_age_hours}h`
        : "unknown age";

    if (
      typeof status.fallback_age_hours === "number" &&
      status.fallback_age_hours > maxFallbackAgeHours
    ) {
      blocking.push(
        `fallback data is ${status.fallback_age_hours}h old, exceeding ${maxFallbackAgeHours}h (${sources})`,
      );
    } else {
      warnings.push(`fallback data in use for: ${sources} (${age})`);
    }
  }

  if (status.degraded === true && blocking.length === 0) {
    const detail =
      typeof status.degraded_reason === "string"
        ? status.degraded_reason
        : degradedSources.join(", ") || "unknown";
    warnings.push(`feed marked degraded: ${detail}`);
  }

  const generatedAt = Date.parse(String(status.generated_at ?? ""));
  if (Number.isFinite(generatedAt)) {
    const ageHours = (Date.now() - generatedAt) / 3_600_000;
    if (ageHours > staleHours) {
      blocking.push(
        `status.json is ${Math.round(ageHours)}h old (threshold ${staleHours}h)`,
      );
    }
  } else {
    blocking.push("status.json missing a valid generated_at timestamp");
  }

  for (const message of evaluateSourceCoverageWarnings(status.sources)) {
    warnings.push(message);
  }

  return { blocking, warnings };
}
