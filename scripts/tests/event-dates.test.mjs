import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEventGroups,
  dateRangeStartKey,
  firstOccurrenceInRange,
  formatMultiDayWhen,
  formatRelativeEventDate,
  listingDateKey,
  occurrenceDateKeys,
  weekEndKey,
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
    ...(overrides.end_date ? { end_date: overrides.end_date } : {}),
    ...(overrides.dates ? { dates: overrides.dates } : {}),
  };
}

// `date` is the day before "today" (2026-05-13), which is what a multi-day
// event looks like from midnight until the next publish.
const RUNNING_EXHIBIT = event({
  id: "exhibit",
  title: "Running Exhibit",
  date: "2026-05-12",
  time: "All day",
  end_date: "2026-05-14",
  dates: ["2026-05-12", "2026-05-13", "2026-05-14"],
});

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
  // The week ends at today+6. A week out shares today's weekday name, so it
  // gets a date instead.
  assert.equal(
    formatRelativeEventDate({ date: "2026-05-29", time: "3:00 PM" }, now),
    "Friday, 3pm",
  );
  assert.equal(
    formatRelativeEventDate({ date: "2026-05-30", time: "3:00 PM" }, now),
    "May 30, 3pm",
  );
});

test("weekEndKey closes This Week at today plus six days", () => {
  assert.equal(weekEndKey("2026-05-23"), "2026-05-29");
  assert.equal(weekEndKey("2026-12-28"), "2027-01-03");
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

test("formatMultiDayWhen counts gappy occurrences in the This Week view", () => {
  const now = new Date("2026-05-23T12:00:00-07:00"); // today = 2026-05-23 PT
  // Two of these three dates fall within today..+6 (May 23–29).
  const label = formatMultiDayWhen(
    {
      date: "2026-05-23",
      end_date: "2026-06-06",
      dates: ["2026-05-23", "2026-05-27", "2026-06-06"],
    },
    now,
    "week",
  );
  assert.equal(label, "2 dates this week");
});

test("formatMultiDayWhen keeps the span label for a continuous run in This Week", () => {
  const now = new Date("2026-05-23T12:00:00-07:00");
  const label = formatMultiDayWhen(
    {
      date: "2026-05-23",
      end_date: "2026-08-31",
      dates: ["2026-05-23", "2026-05-24", "2026-05-25"],
    },
    now,
    "week",
  );
  assert.equal(label, "Through Aug 31");
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

test("occurrence helpers read every day of a multi-day event", () => {
  assert.deepEqual(occurrenceDateKeys(event({ date: "2026-05-13" })), [
    "2026-05-13",
  ]);
  assert.equal(
    firstOccurrenceInRange(RUNNING_EXHIBIT, "2026-05-13"),
    "2026-05-13",
  );
  assert.equal(
    firstOccurrenceInRange(RUNNING_EXHIBIT, "2026-05-14", "2026-05-14"),
    "2026-05-14",
  );
  assert.equal(firstOccurrenceInRange(RUNNING_EXHIBIT, "2026-05-15"), null);
  assert.equal(
    firstOccurrenceInRange(RUNNING_EXHIBIT, undefined, "2026-05-11"),
    null,
  );
  assert.equal(listingDateKey(RUNNING_EXHIBIT, "2026-05-13"), "2026-05-13");
  assert.equal(listingDateKey(RUNNING_EXHIBIT), "2026-05-12");
  assert.equal(listingDateKey(RUNNING_EXHIBIT, "2026-06-01"), "2026-05-12");
});

test("a multi-day event is grouped under the first day of the view", () => {
  const talk = event({
    id: "talk",
    title: "Morning Talk",
    date: "2026-05-13",
    time: "9:00 AM",
  });
  const lecture = event({
    id: "lecture",
    title: "Afternoon Lecture",
    date: "2026-05-14",
    time: "3:00 PM",
  });
  const summarize = (groups) =>
    groups.map((group) => [group.dateKey, group.events.map((item) => item.id)]);

  const weekGroups = buildEventGroups(
    [RUNNING_EXHIBIT, lecture, talk],
    "2026-05-13",
    dateRangeStartKey("week", "2026-05-13"),
  );
  assert.deepEqual(summarize(weekGroups), [
    ["2026-05-13", ["talk", "exhibit"]],
    ["2026-05-14", ["lecture"]],
  ]);

  const tomorrowGroups = buildEventGroups(
    [RUNNING_EXHIBIT, lecture],
    "2026-05-13",
    dateRangeStartKey("tomorrow", "2026-05-13"),
  );
  assert.deepEqual(summarize(tomorrowGroups), [
    ["2026-05-14", ["lecture", "exhibit"]],
  ]);
  assert.equal(tomorrowGroups[0].label, "Tomorrow · May 14");
});
