import assert from "node:assert/strict";
import test from "node:test";

import {
  CANCELED_TITLE_PATTERN,
  appendLastGoodEvents,
  hasFutureOccurrence,
  loadLastGoodForSource,
} from "../../scripts/lib/lastGoodFallback.ts";

function legacy(overrides) {
  return {
    id: "livewhale_evt-1",
    title: "Sample Event",
    organizer: "Berkeley",
    date: "2026-06-15",
    time: "All day",
    location: "Campus",
    description: "",
    tags: ["Academic"],
    url: "https://example.com/events/evt-1",
    source: "livewhale",
    ...overrides,
  };
}

const TODAY = "2026-06-20";

test("hasFutureOccurrence keeps a single-day event today and in the future", () => {
  assert.equal(hasFutureOccurrence(legacy({ date: TODAY }), TODAY), true);
  assert.equal(
    hasFutureOccurrence(legacy({ date: "2026-06-25" }), TODAY),
    true,
  );
});

test("hasFutureOccurrence drops a single-day event whose date is past", () => {
  assert.equal(
    hasFutureOccurrence(legacy({ date: "2026-06-15" }), TODAY),
    false,
  );
});

test("hasFutureOccurrence keeps a multi-day exhibit whose start is past but end_date is future", () => {
  // The bug: a BAMPFA exhibit running Jan→Jun has e.date = earliest-occurrence
  // (Jan 1), which is < today every day after Jan 1. Filtering on e.date alone
  // silently drops the in-progress exhibit from the fallback set.
  const exhibit = legacy({
    id: "bampfa_exhibit-1",
    source: "bampfa",
    date: "2026-01-01",
    end_date: "2026-06-30",
  });
  assert.equal(hasFutureOccurrence(exhibit, TODAY), true);
});

test("hasFutureOccurrence keeps a recurring series whose dates[] still has future entries", () => {
  const series = legacy({
    date: "2026-06-01",
    dates: [
      "2026-06-01",
      "2026-06-08",
      "2026-06-15",
      "2026-06-22",
      "2026-06-29",
    ],
  });
  assert.equal(hasFutureOccurrence(series, TODAY), true);
});

test("hasFutureOccurrence drops a multi-day event whose end_date is also past", () => {
  const past = legacy({
    date: "2026-05-01",
    end_date: "2026-05-31",
    dates: ["2026-05-01", "2026-05-15", "2026-05-31"],
  });
  assert.equal(hasFutureOccurrence(past, TODAY), false);
});

test("hasFutureOccurrence ignores malformed date strings", () => {
  // Garbage date strings (e.g. from a corrupted upstream payload) must not be
  // accidentally accepted as "future" via lexicographic comparison.
  assert.equal(
    hasFutureOccurrence(legacy({ date: "not-a-date" }), TODAY),
    false,
  );
  assert.equal(
    hasFutureOccurrence(legacy({ date: "2026-13-01" }), TODAY),
    false,
  );
});

test("CANCELED_TITLE_PATTERN matches the four upstream cancel markers", () => {
  assert.equal(CANCELED_TITLE_PATTERN.test("Canceled: Workshop X"), true);
  assert.equal(CANCELED_TITLE_PATTERN.test("CANCELLED: Lecture"), true);
  assert.equal(CANCELED_TITLE_PATTERN.test("Postponed: Concert"), true);
  assert.equal(CANCELED_TITLE_PATTERN.test("rescheduled - seminar"), true);
  // Whitespace separator after the marker is also accepted (some upstreams
  // emit "CANCELLED Workshop X" rather than "CANCELLED: Workshop X").
  assert.equal(CANCELED_TITLE_PATTERN.test("Canceled Workshop X"), true);
});

test("CANCELED_TITLE_PATTERN does not match a benign substring", () => {
  // The marker must appear at the start of the title, not anywhere in it.
  assert.equal(
    CANCELED_TITLE_PATTERN.test("Concerts that were almost canceled"),
    false,
  );
});

test("loadLastGoodForSource keeps an in-progress multi-day exhibit (regression: P1 #1)", () => {
  const existing = [
    legacy({
      id: "bampfa_exhibit-1",
      source: "bampfa",
      title: "Long Exhibit",
      date: "2026-01-01",
      end_date: "2026-06-30",
    }),
    legacy({
      id: "bampfa_old-1",
      source: "bampfa",
      title: "Past Workshop",
      date: "2026-05-01",
    }),
  ];

  const restored = loadLastGoodForSource(existing, "bampfa", TODAY);

  assert.equal(restored.length, 1);
  assert.equal(restored[0].id, "bampfa_exhibit-1");
});

test("loadLastGoodForSource excludes canceled events (regression: P1 #2)", () => {
  // Scenario: yesterday's events.json has a workshop that was canceled
  // upstream this morning. The live source then flakes, and markRecovery
  // falls back to existing events. The cancel marker on the title must
  // still suppress the event — otherwise the cancellation is silently undone.
  const existing = [
    legacy({
      id: "callink_workshop-1",
      source: "callink",
      title: "Canceled: Tuesday Workshop",
      date: "2026-06-23",
    }),
    legacy({
      id: "callink_workshop-2",
      source: "callink",
      title: "Open Hours",
      date: "2026-06-22",
    }),
  ];

  const restored = loadLastGoodForSource(existing, "callink", TODAY);

  assert.equal(restored.length, 1);
  assert.equal(restored[0].id, "callink_workshop-2");
});

test("loadLastGoodForSource only returns events for the requested source", () => {
  const existing = [
    legacy({ id: "a", source: "livewhale", date: "2026-06-25" }),
    legacy({ id: "b", source: "bampfa", date: "2026-06-25" }),
    legacy({ id: "c", source: "livewhale", date: "2026-06-26" }),
  ];

  const restored = loadLastGoodForSource(existing, "livewhale", TODAY);

  assert.equal(restored.length, 2);
  assert.deepEqual(restored.map((e) => e.id).sort(), ["a", "c"]);
});

test("appendLastGoodEvents dedupes against ids already in the live set", () => {
  const live = [
    legacy({ id: "shared-1", source: "livewhale", date: "2026-06-25" }),
  ];
  const existing = [
    legacy({ id: "shared-1", source: "livewhale", date: "2026-06-25" }),
    legacy({ id: "fresh-1", source: "livewhale", date: "2026-06-26" }),
  ];

  const restored = appendLastGoodEvents(live, existing, "livewhale", TODAY);

  assert.equal(restored, 1);
  assert.equal(live.length, 2);
  assert.deepEqual(live.map((e) => e.id).sort(), ["fresh-1", "shared-1"]);
});

test("appendLastGoodEvents returns 0 and is a no-op when nothing to restore", () => {
  const live = [
    legacy({ id: "live-1", source: "livewhale", date: "2026-06-25" }),
  ];
  const liveSnapshot = [...live];

  const restored = appendLastGoodEvents(live, [], "livewhale", TODAY);

  assert.equal(restored, 0);
  assert.deepEqual(live, liveSnapshot);
});
