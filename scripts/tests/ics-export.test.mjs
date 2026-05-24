import assert from "node:assert/strict";
import test from "node:test";

import { buildEventIcs } from "../../utils/icsExport.ts";

const TIMED_EVENT = {
  id: "evt-123",
  title: "Quantum Talk",
  organizer: "EECS",
  date: "2026-05-30",
  time: "6:00 PM",
  location: "Soda Hall",
  description: "Evening seminar",
  tags: ["Science & Tech"],
  url: "https://example.com/event",
  source: "livewhale",
};

const ALL_DAY_EVENT = {
  ...TIMED_EVENT,
  id: "evt-all-day",
  time: "All day",
};

test("buildEventIcs emits TZID for timed events", () => {
  const ics = buildEventIcs(TIMED_EVENT);

  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /BEGIN:VEVENT/);
  assert.match(ics, /UID:evt-123@cal-events\.com/);
  assert.match(ics, /DTSTART;TZID=America\/Los_Angeles:20260530T180000/);
  assert.match(ics, /DTEND;TZID=America\/Los_Angeles:20260530T190000/);
  assert.match(ics, /SUMMARY:Quantum Talk/);
  assert.match(ics, /LOCATION:Soda Hall/);
});

test("buildEventIcs emits VALUE=DATE for all-day events", () => {
  const ics = buildEventIcs(ALL_DAY_EVENT);

  assert.match(ics, /DTSTART;VALUE=DATE:20260530/);
  assert.match(ics, /DTEND;VALUE=DATE:20260531/);
});
