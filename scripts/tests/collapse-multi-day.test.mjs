import assert from "node:assert/strict";
import test from "node:test";

import {
  collapseMultiDay,
  stableEventKey,
} from "../../scripts/lib/collapseMultiDay.ts";
import { projectToLegacy } from "../../scripts/lib/normalize.ts";

// Minimal valid-ish CanonicalEvent for collapse/projection (the functions under
// test only read provenance, dates, and the usual display fields).
function ev(overrides) {
  return {
    source_name: "livewhale",
    source_id: "20260528T070000Z-309080@events.berkeley.edu",
    source_url: "https://events.berkeley.edu/live/ical/events",
    title: "Exhibit | Sample Show",
    description: "An exhibit.",
    start_at: "2026-05-28",
    timezone: "America/Los_Angeles",
    all_day: true,
    venue: "Doe Library",
    building: "",
    address: "",
    modality: "in_person",
    organizer: "UC Berkeley Library",
    organizer_unit: "UC Berkeley Library",
    audience: "",
    cost: "",
    canonical_url: "https://events.berkeley.edu/library/event/1",
    categories: [],
    tags: ["Arts"],
    last_seen_at: "2026-05-28T00:00:00.000Z",
    confidence: 1,
    quality_flags: [],
    ...overrides,
  };
}

// One LiveWhale per-day row, sharing the eventNo suffix but varying the datestamp.
function liveWhaleDay(eventNo, date) {
  const stamp = date.replace(/-/g, "") + "T070000Z";
  return ev({
    source_id: `${stamp}-${eventNo}@events.berkeley.edu`,
    start_at: date,
  });
}

test("stableEventKey strips the LiveWhale per-day datestamp prefix", () => {
  assert.equal(
    stableEventKey(liveWhaleDay("309080", "2026-06-15")),
    "livewhale::309080@events.berkeley.edu",
  );
});

test("stableEventKey leaves non-LiveWhale ids intact", () => {
  assert.equal(
    stableEventKey(ev({ source_name: "bampfa", source_id: "film-42" })),
    "bampfa::film-42",
  );
});

test("contiguous per-day rows collapse into one spanning event", () => {
  const days = ["2026-05-28", "2026-05-29", "2026-05-30", "2026-05-31"].map(
    (d) => liveWhaleDay("309080", d),
  );
  const { events, rowsEliminated, multiDayEvents } = collapseMultiDay(days);

  assert.equal(events.length, 1);
  assert.equal(rowsEliminated, 3);
  assert.equal(multiDayEvents, 1);
  const e = events[0];
  assert.equal(e.source_id, "309080@events.berkeley.edu");
  assert.equal(e.start_at, "2026-05-28");
  assert.equal(e.end_at, "2026-05-31");
  assert.deepEqual(e.occurrence_dates, [
    "2026-05-28",
    "2026-05-29",
    "2026-05-30",
    "2026-05-31",
  ]);
});

test("gappy per-day rows collapse but preserve the gaps in occurrence_dates", () => {
  const days = ["2026-06-01", "2026-06-03", "2026-06-08"].map((d) =>
    liveWhaleDay("400000", d),
  );
  const { events } = collapseMultiDay(days);

  assert.equal(events.length, 1);
  assert.equal(events[0].start_at, "2026-06-01");
  assert.equal(events[0].end_at, "2026-06-08");
  assert.deepEqual(events[0].occurrence_dates, [
    "2026-06-01",
    "2026-06-03",
    "2026-06-08",
  ]);
});

test("two distinct events with different eventNos do not merge", () => {
  const input = [
    liveWhaleDay("309080", "2026-05-28"),
    liveWhaleDay("309080", "2026-05-29"),
    liveWhaleDay("309712", "2026-05-28"),
    liveWhaleDay("309712", "2026-05-29"),
  ];
  const { events, multiDayEvents } = collapseMultiDay(input);
  assert.equal(events.length, 2);
  assert.equal(multiDayEvents, 2);
});

test("single-day and non-LiveWhale events pass through unchanged", () => {
  const single = ev({ source_id: "20260601T070000Z-500@events.berkeley.edu" });
  const bampfa = ev({ source_name: "bampfa", source_id: "film-7" });
  const { events, rowsEliminated, multiDayEvents } = collapseMultiDay([
    single,
    bampfa,
  ]);
  assert.equal(events.length, 2);
  assert.equal(rowsEliminated, 0);
  assert.equal(multiDayEvents, 0);
  assert.ok(events.every((e) => e.occurrence_dates === undefined));
});

test("projectToLegacy exposes date range for a collapsed multi-day event", () => {
  const days = ["2026-05-28", "2026-05-29", "2026-05-30"].map((d) =>
    liveWhaleDay("309080", d),
  );
  const { events } = collapseMultiDay(days);
  const legacy = projectToLegacy(events[0]);

  assert.equal(legacy.date, "2026-05-28");
  assert.equal(legacy.end_date, "2026-05-30");
  assert.deepEqual(legacy.dates, ["2026-05-28", "2026-05-29", "2026-05-30"]);
});

test("projectToLegacy omits date range for single-day events", () => {
  const legacy = projectToLegacy(ev());
  assert.equal(legacy.end_date, undefined);
  assert.equal(legacy.dates, undefined);
});
