import assert from "node:assert/strict";
import test from "node:test";

import { buildStatusBanner } from "../../utils/statusUi.ts";

function statusReport(overrides = {}) {
  const now = "2026-04-29T12:00:00.000Z";
  return {
    generated_at: now,
    total_events: 1000,
    duplicates_removed: 0,
    past_events_filtered: 0,
    invalid_events_filtered: 0,
    sources: [
      {
        name: "bampfa",
        ok: false,
        count: 0,
        duration_ms: 60_000,
        fetched_at: now,
        error: "bampfa timed out after 60000ms",
        degraded: true,
        fallback_used: true,
        fallback_count: 95,
      },
    ],
    fallback_used: true,
    degraded: true,
    degraded_reason: "bampfa failed: bampfa timed out after 60000ms",
    last_good_used: 95,
    fallback_sources: ["bampfa"],
    degraded_sources: ["bampfa"],
    ...overrides,
  };
}

test("recovered fallback status stays silent in the public UI", () => {
  assert.equal(buildStatusBanner(statusReport()), null);
});

test("healthy dataset with a failed non-critical source stays silent", () => {
  assert.equal(
    buildStatusBanner(
      statusReport({
        sources: [
          {
            name: "gemini",
            ok: false,
            count: 0,
            duration_ms: 60_000,
            fetched_at: "2026-04-29T12:00:00.000Z",
            error: "gemini timed out after 60000ms",
          },
        ],
        fallback_used: false,
        degraded: false,
        degraded_reason: undefined,
        last_good_used: 0,
        fallback_sources: [],
        degraded_sources: [],
      }),
    ),
    null,
  );
});

test("data-quality blocked fallback still shows a warning", () => {
  const banner = buildStatusBanner(
    statusReport({
      data_quality_blocked: true,
    }),
  );

  assert.equal(banner?.tone, "warning");
  assert.equal(banner?.title, "Showing mostly fresh data.");
});

test("unrecovered degraded status still shows a warning", () => {
  const banner = buildStatusBanner(
    statusReport({
      fallback_used: false,
      last_good_used: 0,
      fallback_sources: [],
    }),
  );

  assert.equal(banner?.tone, "warning");
  assert.equal(banner?.title, "Showing partial data.");
});
