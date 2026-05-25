import assert from "node:assert/strict";
import test from "node:test";

import { evaluateFeedHealth } from "../lib/feedHealthPolicy.mjs";

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

test("evaluateFeedHealth blocks unrecovered critical source degradation", () => {
  const result = evaluateFeedHealth(
    {
      ...healthyStatus,
      degraded: true,
      degraded_sources: ["bampfa"],
      degraded_reason: "bampfa failed: timeout",
      fallback_sources: [],
    },
    { staleHours: 36, maxFallbackAgeHours: 48 },
  );

  assert.match(result.blocking.join(" "), /critical source\(s\) degraded/);
  assert.match(result.blocking.join(" "), /bampfa/);
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
