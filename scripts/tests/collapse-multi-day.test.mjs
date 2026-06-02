import assert from "node:assert/strict";
import test from "node:test";

import {
  collapseMultiDay,
  stableEventKey,
} from "../../scripts/lib/collapseMultiDay.ts";
import { projectToLegacy } from "../../scripts/lib/normalize.ts";

// Minimal valid-ish CanonicalEvent for collapse/projection (the functions under
// test only read provenance, dates, and the usual display fields).
/** @param {Partial<import("../../scripts/lib/schema.ts").CanonicalEvent>} overrides */
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

// One BAMPFA per-day row: source_id is "<month-specific-slug>::<date>".
function bampfaDay(slug, date) {
  return ev({
    source_name: "bampfa",
    source_id: `${slug}::${date}`,
    start_at: date,
    title: "Open: Art Lab",
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

test("stableEventKey leaves unlisted-source ids with ::date suffix untouched", () => {
  // Regression: sources not in ID_STRIP_RULES (e.g., luma, callink, cal_performances)
  // must NOT have their occurrence date stripped, even if the id looks BAMPFA-like.
  assert.equal(
    stableEventKey(
      ev({ source_name: "luma", source_id: "my-event::2026-06-05" }),
    ),
    "luma::my-event::2026-06-05",
  );
  assert.equal(
    stableEventKey(
      ev({
        source_name: "cal_performances",
        source_id: "concert-june-2026::2026-06-10",
      }),
    ),
    "cal_performances::concert-june-2026::2026-06-10",
  );
});

test("unlisted source with ::date suffix does not collapse across rows", () => {
  // Two Luma events sharing the same slug stem but different occurrence dates
  // must remain two events (Luma is not in ID_STRIP_RULES).
  const days = [
    ev({
      source_name: "luma",
      source_id: "weekly-meetup::2026-06-05",
      start_at: "2026-06-05",
    }),
    ev({
      source_name: "luma",
      source_id: "weekly-meetup::2026-06-12",
      start_at: "2026-06-12",
    }),
  ];
  const { events, multiDayEvents } = collapseMultiDay(days);
  assert.equal(events.length, 2);
  assert.equal(multiDayEvents, 0);
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

// One Simons per-day row: source_id is "<url-slug>::<date>".
function simonsDay(slug, date) {
  return ev({
    source_name: "simons",
    source_id: `${slug}::${date}`,
    start_at: date,
    title: "Tea Time Talks",
  });
}

test("stableEventKey strips a BAMPFA occurrence date and month-specific slug", () => {
  assert.equal(
    stableEventKey(bampfaDay("open-art-lab-june-2026", "2026-06-04")),
    "bampfa::open-art-lab",
  );
});

test("stableEventKey strips a Simons occurrence date", () => {
  assert.equal(
    stableEventKey(simonsDay("events-tea-time-talks", "2026-06-05")),
    "simons::events-tea-time-talks",
  );
});

test("BAMPFA recurring program collapses across months into one event", () => {
  // Feed out-of-order to exercise the internal sort.
  const days = [
    bampfaDay("open-art-lab-july-2026", "2026-07-02"),
    bampfaDay("open-art-lab-june-2026", "2026-06-05"),
    bampfaDay("open-art-lab-may-2026", "2026-05-29"),
    bampfaDay("open-art-lab-june-2026", "2026-06-04"),
  ];
  const { events, multiDayEvents } = collapseMultiDay(days);

  assert.equal(events.length, 1);
  assert.equal(multiDayEvents, 1);
  assert.equal(events[0].source_id, "open-art-lab");
  assert.equal(events[0].start_at, "2026-05-29");
  assert.equal(events[0].end_at, "2026-07-02");
  assert.deepEqual(events[0].occurrence_dates, [
    "2026-05-29",
    "2026-06-04",
    "2026-06-05",
    "2026-07-02",
  ]);
});

test("BAMPFA slug without a month suffix collapses by occurrence date alone", () => {
  // TRAILING_OCCURRENCE_DATE fires; TRAILING_MONTH_SLUG is a no-op.
  const days = [
    ev({
      source_name: "bampfa",
      source_id: "permanent-collection::2026-06-10",
      start_at: "2026-06-10",
    }),
    ev({
      source_name: "bampfa",
      source_id: "permanent-collection::2026-06-17",
      start_at: "2026-06-17",
    }),
  ];
  const { events, multiDayEvents } = collapseMultiDay(days);
  assert.equal(events.length, 1);
  assert.equal(multiDayEvents, 1);
  assert.equal(events[0].source_id, "permanent-collection");
  assert.deepEqual(events[0].occurrence_dates, ["2026-06-10", "2026-06-17"]);
});

test("two distinct BAMPFA programs with different discriminators do not merge", () => {
  const input = [
    bampfaDay("workshop-a-june-2026", "2026-06-01"),
    bampfaDay("workshop-b-june-2026", "2026-06-01"),
  ];
  const { events } = collapseMultiDay(input);
  // Stable keys are bampfa::workshop-a and bampfa::workshop-b — distinct groups.
  // Each has only one occurrence so they pass through the single-day path with
  // the original source_id intact (stripping only applies in the multi-day path).
  assert.equal(events.length, 2);
  const ids = events.map((e) => e.source_id).sort();
  assert.deepEqual(ids, [
    "workshop-a-june-2026::2026-06-01",
    "workshop-b-june-2026::2026-06-01",
  ]);
});

test("Simons recurring event collapses weekly occurrences into one event", () => {
  const days = [
    simonsDay("events-tea-time-talks", "2026-06-05"),
    simonsDay("events-tea-time-talks", "2026-06-12"),
    simonsDay("events-tea-time-talks", "2026-06-19"),
  ];
  const { events, rowsEliminated, multiDayEvents } = collapseMultiDay(days);
  assert.equal(events.length, 1);
  assert.equal(rowsEliminated, 2);
  assert.equal(multiDayEvents, 1);
  assert.equal(events[0].source_id, "events-tea-time-talks");
  assert.equal(events[0].start_at, "2026-06-05");
  assert.equal(events[0].end_at, "2026-06-19");
  assert.deepEqual(events[0].occurrence_dates, [
    "2026-06-05",
    "2026-06-12",
    "2026-06-19",
  ]);
});

test("Simons events with different slugs do not merge", () => {
  const input = [
    simonsDay("events-talk-a", "2026-06-05"),
    simonsDay("events-talk-b", "2026-06-05"),
  ];
  const { events } = collapseMultiDay(input);
  assert.equal(events.length, 2);
  // Each is a single-occurrence event, so source_id passes through unchanged.
  const ids = events.map((e) => e.source_id).sort();
  assert.deepEqual(ids, [
    "events-talk-a::2026-06-05",
    "events-talk-b::2026-06-05",
  ]);
});

test("month name in the middle of a BAMPFA slug is not stripped (regex anchored at $)", () => {
  assert.equal(
    stableEventKey(
      ev({ source_name: "bampfa", source_id: "june-film-series" }),
    ),
    "bampfa::june-film-series",
  );
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

test("projectToLegacy exposes date range for a BAMPFA collapsed event", () => {
  const days = [
    bampfaDay("open-art-lab-may-2026", "2026-05-29"),
    bampfaDay("open-art-lab-june-2026", "2026-06-04"),
    bampfaDay("open-art-lab-june-2026", "2026-06-05"),
  ];
  const { events } = collapseMultiDay(days);
  const legacy = projectToLegacy(events[0]);

  assert.equal(legacy.date, "2026-05-29");
  assert.equal(legacy.end_date, "2026-06-05");
  assert.deepEqual(legacy.dates, ["2026-05-29", "2026-06-04", "2026-06-05"]);
  assert.equal(legacy.source, "bampfa");
});

test("projectToLegacy omits date range for single-day events", () => {
  const legacy = projectToLegacy(ev());
  assert.equal(legacy.end_date, undefined);
  assert.equal(legacy.dates, undefined);
});
