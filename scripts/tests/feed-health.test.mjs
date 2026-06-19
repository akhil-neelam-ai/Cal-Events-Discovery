import assert from "node:assert/strict";
import test from "node:test";

import {
  CRITICAL_SOURCES,
  evaluateFeedHealth,
} from "../lib/feedHealthPolicy.ts";

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

test("evaluateFeedHealth blocks stale fallback data", () => {
  const result = evaluateFeedHealth(
    {
      ...healthyStatus,
      fallback_used: true,
      fallback_age_hours: 72,
      fallback_sources: ["livewhale"],
    },
    { staleHours: 36, maxFallbackAgeHours: 48 },
  );

  assert.match(result.blocking.join(" "), /fallback data is 72h old/);
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
