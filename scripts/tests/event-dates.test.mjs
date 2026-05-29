import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEventGroups,
  formatMultiDayWhen,
  formatRelativeEventDate,
} from "../../utils/eventDates.ts";

function event(overrides = {}) {
  return {
    id: overrides.id ?? "event",
    title: overrides.title ?? "Campus Event",
    organizer: "UC Berkeley",
    date: overrides.date ?? "2026-05-13",
    time: overrides.time ?? "12:00 PM",
    location: "Campus",
    description: "Test event",
    tags: ["Academic"],
    url: "https://example.com",
    source: "livewhale",
  };
}

test("event groups are chronological even when caller input is relevance ordered", () => {
  const groups = buildEventGroups([
    event({
      id: "june",
      title: "June AI Workshop",
      date: "2026-06-01",
      time: "9:00 AM",
    }),
    event({
      id: "may-late",
      title: "May Late Talk",
      date: "2026-05-13",
      time: "5:00 PM",
    }),
    event({
      id: "october",
      title: "October AI Forum",
      date: "2026-10-05",
      time: "1:00 PM",
    }),
    event({
      id: "may-early",
      title: "May Early Talk",
      date: "2026-05-13",
      time: "9:00 AM",
    }),
  ]);

  assert.deepEqual(
    groups.map((group) => group.dateKey),
    ["2026-05-13", "2026-06-01", "2026-10-05"],
  );
  assert.deepEqual(
    groups[0].events.map((item) => item.id),
    ["may-early", "may-late"],
  );
});

test("formatRelativeEventDate uses today, tomorrow, weekday, and absolute labels", () => {
  const now = new Date("2026-05-23T18:00:00-07:00");

  assert.equal(
    formatRelativeEventDate({ date: "2026-05-23", time: "6:00 PM" }, now),
    "Today, 6pm",
  );
  assert.equal(
    formatRelativeEventDate({ date: "2026-05-24", time: "All day" }, now),
    "Tomorrow, All day",
  );
  assert.equal(
    formatRelativeEventDate({ date: "2026-05-28", time: "3:00 PM" }, now),
    "Thursday, 3pm",
  );
  assert.equal(
    formatRelativeEventDate({ date: "2026-06-10", time: "11:00 AM" }, now),
    "Jun 10, 11am",
  );
});

test("formatMultiDayWhen labels a continuous on-view run as 'Through'", () => {
  const now = new Date("2026-05-23T12:00:00-07:00"); // today = 2026-05-23 PT
  const label = formatMultiDayWhen(
    {
      date: "2026-05-23",
      end_date: "2026-05-26",
      dates: ["2026-05-23", "2026-05-24", "2026-05-25", "2026-05-26"],
    },
    now,
  );
  assert.equal(label, "Through May 26");
});

test("formatMultiDayWhen labels a future run as a date span", () => {
  const now = new Date("2026-05-23T12:00:00-07:00");
  const label = formatMultiDayWhen(
    {
      date: "2026-06-11",
      end_date: "2026-06-14",
      dates: ["2026-06-11", "2026-06-12", "2026-06-13", "2026-06-14"],
    },
    now,
  );
  assert.equal(label, "Jun 11 – Jun 14");
});

test("formatMultiDayWhen prefixes gappy/recurring runs with a date count", () => {
  const now = new Date("2026-05-23T12:00:00-07:00");
  const label = formatMultiDayWhen(
    {
      date: "2026-05-23",
      end_date: "2026-06-06",
      dates: ["2026-05-23", "2026-05-30", "2026-06-06"],
    },
    now,
  );
  assert.equal(label, "3 dates · Through Jun 6");
});

test("formatMultiDayWhen returns null for single-day events", () => {
  assert.equal(formatMultiDayWhen({ date: "2026-05-23" }), null);
  assert.equal(
    formatMultiDayWhen({ date: "2026-05-23", dates: ["2026-05-23"] }),
    null,
  );
});

test("formatRelativeEventDate uses the multi-day span when present", () => {
  const now = new Date("2026-05-23T12:00:00-07:00");
  assert.equal(
    formatRelativeEventDate(
      {
        date: "2026-05-23",
        time: "All day",
        end_date: "2026-05-25",
        dates: ["2026-05-23", "2026-05-24", "2026-05-25"],
      },
      now,
    ),
    "Through May 25",
  );
});
