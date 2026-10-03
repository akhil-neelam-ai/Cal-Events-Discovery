import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEventIcs,
  buildGoogleCalendarUrl,
  downloadEventIcs,
} from "../../utils/icsExport.ts";

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

test("buildEventIcs spans a contiguous multi-day all-day run as one VEVENT", () => {
  const ics = buildEventIcs({
    ...ALL_DAY_EVENT,
    id: "evt-exhibit",
    end_date: "2026-06-02",
    dates: ["2026-05-30", "2026-05-31", "2026-06-01", "2026-06-02"],
  });

  // exactly one VEVENT, spanning start..(end+1) exclusive
  assert.equal(ics.match(/BEGIN:VEVENT/g).length, 1);
  assert.match(ics, /DTSTART;VALUE=DATE:20260530/);
  assert.match(ics, /DTEND;VALUE=DATE:20260603/);
});

test("buildEventIcs emits one VEVENT per occurrence for a gappy run", () => {
  const ics = buildEventIcs({
    ...ALL_DAY_EVENT,
    id: "evt-recurring",
    end_date: "2026-06-08",
    dates: ["2026-06-01", "2026-06-03", "2026-06-08"],
  });

  assert.equal(ics.match(/BEGIN:VEVENT/g).length, 3);
  assert.match(ics, /UID:evt-recurring-2026-06-01@cal-events\.com/);
  assert.match(ics, /UID:evt-recurring-2026-06-08@cal-events\.com/);
  // each occurrence is its own single all-day day
  assert.match(ics, /DTSTART;VALUE=DATE:20260603/);
  assert.match(ics, /DTEND;VALUE=DATE:20260604/);
});

test("buildEventIcs leaves single-day events as one VEVENT", () => {
  const ics = buildEventIcs(TIMED_EVENT);
  assert.equal(ics.match(/BEGIN:VEVENT/g).length, 1);
});

test("buildEventIcs rolls a late-evening DTEND into the next day", () => {
  const ics = buildEventIcs({
    ...TIMED_EVENT,
    id: "evt-late",
    date: "2026-05-30",
    time: "11:00 PM",
  });

  assert.match(ics, /DTSTART;TZID=America\/Los_Angeles:20260530T230000/);
  // 11 PM + 1h must advance the date and use a valid 00 hour, not T240000.
  assert.match(ics, /DTEND;TZID=America\/Los_Angeles:20260531T000000/);
  assert.doesNotMatch(ics, /T24\d{4}/);
});

test("buildEventIcs escapes ICS control characters in text fields", () => {
  const ics = buildEventIcs({
    ...TIMED_EVENT,
    id: "evt-escape",
    title: "Jazz; Blues, and \\Soul",
    description: "Line one\nLine two; with, commas\\and slashes",
    location: "Room 1; Bldg, A",
  });

  assert.match(ics, /SUMMARY:Jazz\\; Blues\\, and \\\\Soul/);
  assert.match(
    ics,
    /DESCRIPTION:Line one\\nLine two\\; with\\, commas\\\\and slashes/,
  );
  assert.match(ics, /LOCATION:Room 1\\; Bldg\\, A/);
  // No raw newline must break a property line: every line ends with \r.
  for (const line of ics.split("\r\n")) {
    assert.doesNotMatch(line, /\n/);
  }
});

test("buildGoogleCalendarUrl uses PT local times with ctz", () => {
  const url = buildGoogleCalendarUrl(TIMED_EVENT);
  assert.ok(url);
  const parsed = new URL(url);
  assert.equal(
    parsed.origin + parsed.pathname,
    "https://calendar.google.com/calendar/render",
  );
  assert.equal(parsed.searchParams.get("action"), "TEMPLATE");
  assert.equal(parsed.searchParams.get("text"), "Quantum Talk");
  assert.equal(
    parsed.searchParams.get("dates"),
    "20260530T180000/20260530T190000",
  );
  assert.equal(parsed.searchParams.get("ctz"), "America/Los_Angeles");
  assert.equal(parsed.searchParams.get("location"), "Soda Hall");
});

test("buildGoogleCalendarUrl omits ctz for all-day events", () => {
  const url = buildGoogleCalendarUrl(ALL_DAY_EVENT);
  assert.ok(url);
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("dates"), "20260530/20260531");
  assert.equal(parsed.searchParams.get("ctz"), null);
});

test("buildGoogleCalendarUrl returns null for gappy multi-day runs", () => {
  const url = buildGoogleCalendarUrl({
    ...ALL_DAY_EVENT,
    dates: ["2026-06-01", "2026-06-03", "2026-06-08"],
  });
  assert.equal(url, null);
});

test("buildGoogleCalendarUrl spans contiguous all-day runs", () => {
  const url = buildGoogleCalendarUrl({
    ...ALL_DAY_EVENT,
    dates: ["2026-05-30", "2026-05-31", "2026-06-01", "2026-06-02"],
  });
  assert.ok(url);
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("dates"), "20260530/20260603");
});

test("buildEventIcs turns carriage returns into escaped line breaks", () => {
  const ics = buildEventIcs({
    ...TIMED_EVENT,
    id: "evt-cr",
    description: "Line one\r\nLine two\rLine three",
    location: "Calvin Lab\r\nAuditorium",
  });

  assert.match(ics, /DESCRIPTION:Line one\\nLine two\\nLine three\r\n/);
  assert.match(ics, /LOCATION:Calvin Lab\\nAuditorium\r\n/);
  for (const line of ics.split("\r\n")) {
    assert.doesNotMatch(line, /[\r\n]/);
  }
});

test("buildEventIcs defines the Los Angeles zone its timed events use", () => {
  const ics = buildEventIcs(TIMED_EVENT);
  const zone = ics.indexOf("BEGIN:VTIMEZONE");

  assert.ok(zone > 0, "a timed event needs a VTIMEZONE block");
  assert.ok(zone < ics.indexOf("BEGIN:VEVENT"));
  assert.match(ics, /BEGIN:VTIMEZONE\r\nTZID:America\/Los_Angeles\r\n/);
  assert.match(
    ics,
    /BEGIN:DAYLIGHT\r\nTZOFFSETFROM:-0800\r\nTZOFFSETTO:-0700\r\n/,
  );
  assert.match(
    ics,
    /BEGIN:STANDARD\r\nTZOFFSETFROM:-0700\r\nTZOFFSETTO:-0800\r\n/,
  );
  assert.match(ics, /RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU/);
  assert.match(ics, /RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU/);
  assert.equal(ics.match(/BEGIN:VTIMEZONE/g).length, 1);
});

test("buildEventIcs leaves out the zone when every VEVENT is all day", () => {
  assert.doesNotMatch(buildEventIcs(ALL_DAY_EVENT), /VTIMEZONE/);
});

test("downloadEventIcs keeps the object URL alive while the download starts", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const revoke = t.mock.method(URL, "revokeObjectURL", () => {});
  t.mock.method(URL, "createObjectURL", () => "blob:calendar");
  const anchor = { href: "", download: "", clicked: false };
  anchor.click = () => {
    anchor.clicked = true;
  };
  globalThis.document = { createElement: () => anchor };
  t.after(() => {
    delete globalThis.document;
  });

  downloadEventIcs(TIMED_EVENT);

  assert.equal(anchor.clicked, true);
  assert.equal(anchor.href, "blob:calendar");
  assert.equal(revoke.mock.callCount(), 0);
  t.mock.timers.tick(40_000);
  assert.equal(revoke.mock.callCount(), 1);
  assert.deepEqual(revoke.mock.calls[0].arguments, ["blob:calendar"]);
});
