import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEventGroups,
  dateRangeStartKey,
  firstOccurrenceInRange,
  formatMultiDayWhen,
  formatRelativeEventDate,
  getCurrentPacificMinutes,
  hasEventEnded,
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
    ...(overrides.end_time ? { end_time: overrides.end_time } : {}),
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

test("multi-day labels follow the synced today key", () => {
  const run = {
    date: "2026-05-02",
    end_date: "2026-05-04",
    dates: ["2026-05-02", "2026-05-03", "2026-05-04"],
    time: "All day",
  };
  // 00:30 PT on May 2. The synced key still says May 1 until its refresh.
  const now = new Date("2026-05-02T07:30:00Z");

  assert.equal(
    formatRelativeEventDate(run, now, "upcoming", "2026-05-01"),
    "May 2 – May 4",
  );
  assert.equal(formatRelativeEventDate(run, now, "upcoming"), "Through May 4");
});

test("getCurrentPacificMinutes reads the Pacific wall clock", () => {
  // 05:00Z on Oct 18 is 10:00 PM PDT on Oct 17.
  assert.equal(
    getCurrentPacificMinutes(new Date("2026-10-18T05:00:00Z")),
    22 * 60,
  );
  // 08:30Z on Jan 15 is 12:30 AM PST.
  assert.equal(getCurrentPacificMinutes(new Date("2026-01-15T08:30:00Z")), 30);
});

test("hasEventEnded hides today's events once their end time passes", () => {
  const today = "2026-05-13";
  const tenPm = 22 * 60;
  const morning = event({ time: "10:00 AM", end_time: "11:30 AM" });

  assert.equal(hasEventEnded(morning, today, tenPm), true);
  assert.equal(hasEventEnded(morning, today, 11 * 60 + 29), false);
  assert.equal(hasEventEnded(morning, today, 11 * 60 + 30), true);
  // Only today's events end early. Later days wait for their own day.
  assert.equal(
    hasEventEnded({ ...morning, date: "2026-05-14" }, today, tenPm),
    false,
  );

  // No published end, or an end past midnight, keeps the event all day.
  assert.equal(hasEventEnded(event({ time: "10:00 AM" }), today, tenPm), false);
  assert.equal(
    hasEventEnded(
      event({ time: "9:00 PM", end_time: "1:00 AM" }),
      today,
      23 * 60 + 59,
    ),
    false,
  );
  assert.equal(
    hasEventEnded(
      event({ time: "All day", end_time: "5:00 PM" }),
      today,
      tenPm,
    ),
    false,
  );
});
