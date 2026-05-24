import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEventGroups,
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
