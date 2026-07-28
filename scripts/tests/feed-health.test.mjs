import assert from "node:assert/strict";
import test from "node:test";

import {
  CRITICAL_SOURCES,
  evaluateFeedHealth,
} from "../lib/feedHealthPolicy.ts";
import {
  CONTRACTS,
  CRITICAL_CONTRACT_SOURCES,
} from "../lib/sourceContracts.mjs";

const healthyStatus = {
  generated_at: new Date().toISOString(),
  total_events: 942,
  degraded: false,
  fallback_used: false,
  data_quality_blocked: false,
  degraded_sources: [],
  fallback_sources: [],
};

test("evaluateFeedHealth passes a healthy status report", () => {
  const result = evaluateFeedHealth(healthyStatus, {
    staleHours: 36,
    maxFallbackAgeHours: 48,
  });

  assert.deepEqual(result.blocking, []);
  assert.deepEqual(result.warnings, []);
});

test("evaluateFeedHealth blocks unrecovered critical (livewhale) degradation", () => {
  const result = evaluateFeedHealth(
    {
      ...healthyStatus,
      degraded: true,
      degraded_sources: ["livewhale"],
      degraded_reason: "livewhale failed: timeout",
      fallback_sources: [],
    },
    { staleHours: 36, maxFallbackAgeHours: 48 },
  );

  assert.match(result.blocking.join(" "), /critical source\(s\) degraded/);
  assert.match(result.blocking.join(" "), /livewhale/);
});

test("evaluateFeedHealth warns (does not block) on supplementary source degradation", () => {
  // Non-backbone sources are platform-capped, scraped from fragile endpoints, or
  // sparse between terms. One going down must not hard-fail the daily publish.
  for (const source of ["bampfa", "callink", "luma", "begin", "simons"]) {
    const result = evaluateFeedHealth(
      {
        ...healthyStatus,
        degraded: true,
        degraded_sources: [source],
        degraded_reason: `${source} failed: timeout`,
        fallback_sources: [],
      },
      { staleHours: 36, maxFallbackAgeHours: 48 },
    );

    assert.deepEqual(
      result.blocking,
      [],
      `${source} degradation should not block`,
    );
    assert.match(
      result.warnings.join(" "),
      new RegExp(`non-critical source\\(s\\) degraded.*${source}`),
      `${source} degradation should warn`,
    );
  }
});

test("evaluateFeedHealth warns but does not block recovered critical fallback", () => {
  const result = evaluateFeedHealth(
    {
      ...healthyStatus,
      degraded: true,
      fallback_used: true,
      fallback_age_hours: 12,
      degraded_sources: ["livewhale"],
      fallback_sources: ["livewhale"],
    },
    { staleHours: 36, maxFallbackAgeHours: 48 },
  );

  assert.deepEqual(result.blocking, []);
  assert.match(result.warnings.join(" "), /recovered via fallback/);
});

test("evaluateFeedHealth blocks expired fallback on a critical source", () => {
  const result = evaluateFeedHealth(
    {
      ...healthyStatus,
      degraded: true,
      degraded_sources: ["livewhale"],
      stale_fallback_sources: ["livewhale"],
    },
    { staleHours: 36, maxFallbackAgeHours: 48 },
  );

  assert.match(
    result.blocking.join(" "),
    /critical source\(s\) on fallback older than 48h.*livewhale/,
  );
});

test("evaluateFeedHealth warns (does not block) on expired supplementary fallback", () => {
  // A dead supplementary scraper losing its stale last-good copy costs us that
  // one source. It must never discard the fresh events every other source
  // returned — that regression took the whole publish down in July 2026.
  const result = evaluateFeedHealth(
    {
      ...healthyStatus,
      degraded: true,
      degraded_sources: ["bampfa"],
      stale_fallback_sources: ["bampfa"],
    },
    { staleHours: 36, maxFallbackAgeHours: 48 },
  );

  assert.deepEqual(result.blocking, []);
  assert.match(
    result.warnings.join(" "),
    /expired fallback dropped for.*bampfa/,
  );
});

test("CRITICAL_SOURCES is backbone-only and shared by both gates", () => {
  // The publish gate (scripts/updateEvents.ts) imports this exact set, so the
  // CI health check and the publish gate cannot disagree on what is critical.
  // Only LiveWhale (the campus-calendar backbone) is critical; supplementary
  // sources warn instead of blocking.
  assert.ok(CRITICAL_SOURCES.has("livewhale"));
  assert.equal(CRITICAL_SOURCES.size, 1);

  for (const source of ["luma", "begin", "callink", "bampfa"]) {
    assert.ok(
      !CRITICAL_SOURCES.has(source),
      `${source} should be supplementary, not critical`,
    );
  }
});

test("contract runner's critical set matches the shared policy", () => {
  // scripts/lib/sourceContracts.mjs must stay plain .mjs (bare Node, no loader)
  // so it duplicates CRITICAL_SOURCES instead of importing it. This test is what
  // keeps the copy honest: the Source Contracts workflow, the publish gate, and
  // the CI health check must agree on which sources are allowed to fail a build.
  assert.deepEqual(
    [...CRITICAL_CONTRACT_SOURCES].sort(),
    [...CRITICAL_SOURCES].sort(),
  );
});

test("every contract source is a real, non-retired source", () => {
  // A contract for a source the pipeline no longer fetches is pure false alarm:
  // it can only ever fail the workflow for a feed nobody consumes.
  const contractNames = CONTRACTS.map((contract) => contract.name);
  assert.ok(contractNames.includes("livewhale"));
  assert.ok(
    !contractNames.includes("ehub"),
    "ehub was retired (upstream page deleted 2026-07); its contract must go too",
  );
  assert.equal(
    new Set(contractNames).size,
    contractNames.length,
    "contract names must be unique",
  );
});

test("evaluateFeedHealth warns on thin source coverage", () => {
  const result = evaluateFeedHealth(
    {
      ...healthyStatus,
      sources: [
        {
          name: "callink",
          ok: true,
          count: 1,
          duration_ms: 100,
          fetched_at: healthyStatus.generated_at,
        },
        {
          name: "livewhale",
          ok: true,
          count: 1200,
          duration_ms: 100,
          fetched_at: healthyStatus.generated_at,
        },
      ],
    },
    { staleHours: 36, maxFallbackAgeHours: 48 },
  );

  assert.deepEqual(result.blocking, []);
  assert.match(
    result.warnings.join(" "),
    /callink returned 1 events \(expected >= 5\)/,
  );
});
