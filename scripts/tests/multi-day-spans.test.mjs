import assert from "node:assert/strict";
import test from "node:test";

import { collapseMultiDay } from "../../scripts/lib/collapseMultiDay.ts";
import { dedupeEvents } from "../../scripts/lib/dedupe.ts";
import {
  endedBeforePT,
  lastDayInPT,
  MAX_SPAN_DAYS,
  projectToLegacy,
  todayPT,
  withSpanOccurrences,
} from "../../scripts/lib/normalize.ts";
import { fetchLiveWhale } from "../../scripts/sources/livewhale.ts";
import { fetchHaas } from "../../scripts/sources/tribe.ts";

function addDays(key, days) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

function daysFrom(start, count) {
  return Array.from({ length: count }, (_, offset) => addDays(start, offset));
}

// 19:00Z and 23:00Z fall on the same PT day in both PDT and PST.
const at = (key, hhmm) => `${key}T${hhmm}:00.000Z`;

const TODAY = todayPT();
const YESTERDAY = addDays(TODAY, -1);
const TWO_DAYS_AGO = addDays(TODAY, -2);
const TOMORROW = addDays(TODAY, 1);

/** @param {Partial<import("../../scripts/lib/schema.ts").CanonicalEvent>} overrides */
function canonical(overrides) {
  return {
    source_name: "livewhale",
    source_id: "span-1",
    source_url: "https://events.berkeley.edu/live/ical/events",
    title: "Robotics Conference",
    description: "A conference.",
    start_at: at(YESTERDAY, "19:00"),
    timezone: "America/Los_Angeles",
    all_day: false,
    venue: "Sutardja Dai Hall",
    building: "",
    address: "",
    modality: "in_person",
    organizer: "EECS",
    organizer_unit: "EECS",
    audience: "",
    cost: "",
    canonical_url: "https://events.berkeley.edu/eecs/event/1",
    categories: [],
    tags: ["Science & Tech"],
    last_seen_at: "2026-09-25T00:00:00.000Z",
    confidence: 1,
    quality_flags: [],
    ...overrides,
  };
}

test("lastDayInPT reads exclusive all-day ends and overnight shows", () => {
  const allDay = { start_at: "2026-09-20", all_day: true };
  assert.equal(lastDayInPT({ ...allDay, end_at: "2026-09-27" }), "2026-09-26");
  assert.equal(lastDayInPT({ ...allDay, end_at: "2026-09-21" }), "2026-09-20");
  assert.equal(lastDayInPT(allDay), "2026-09-20");

  const timed = { start_at: "2026-09-20T19:00:00.000Z", all_day: false };
  assert.equal(
    lastDayInPT({ ...timed, end_at: "2026-09-22T23:00:00.000Z" }),
    "2026-09-22",
  );
  // 10 PM to 1 AM PT stays on the night it started.
  assert.equal(
    lastDayInPT({
      start_at: "2026-09-21T05:00:00.000Z",
      end_at: "2026-09-21T08:00:00.000Z",
      all_day: false,
    }),
    "2026-09-20",
  );
  // A Tribe all-day end is 11:59:59 PM local, which is inclusive.
  assert.equal(
    lastDayInPT({
      start_at: "2026-09-20T07:00:00.000Z",
      end_at: "2026-09-23T06:59:59.000Z",
      all_day: true,
    }),
    "2026-09-22",
  );
  // An end before the start is a one-day event.
  assert.equal(
    lastDayInPT({ ...timed, end_at: "2026-09-19T23:00:00.000Z" }),
    "2026-09-20",
  );
  assert.equal(lastDayInPT({ ...timed, end_at: "not-a-date" }), "2026-09-20");
});

test("endedBeforePT keeps a running span and drops a finished one", () => {
  const running = {
    start_at: at(TWO_DAYS_AGO, "19:00"),
    end_at: at(TOMORROW, "23:00"),
    all_day: false,
  };
  assert.equal(endedBeforePT(running, TODAY), false);
  assert.equal(
    endedBeforePT({ ...running, end_at: at(YESTERDAY, "23:00") }, TODAY),
    true,
  );
  assert.equal(
    endedBeforePT({ start_at: YESTERDAY, end_at: TODAY, all_day: true }, TODAY),
    true,
  );
});

test("a running span publishes today as its date and every day left", () => {
  const span = canonical({ end_at: at(TOMORROW, "23:00") });
  const legacy = projectToLegacy(withSpanOccurrences(span, TODAY));

  assert.equal(legacy.date, TODAY);
  assert.deepEqual(legacy.dates, [TODAY, TOMORROW]);
  assert.equal(legacy.end_date, TOMORROW);
});

test("a span on its last day publishes as a one-day event today", () => {
  const span = canonical({ end_at: at(TODAY, "23:00") });
  const legacy = projectToLegacy(withSpanOccurrences(span, TODAY));

  assert.equal(legacy.date, TODAY);
  assert.equal(legacy.dates, undefined);
  assert.equal(legacy.end_date, undefined);
});

test("a long span caps its dates but keeps the real end date", () => {
  const lastDay = addDays(TODAY, 200);
  const span = canonical({
    start_at: TWO_DAYS_AGO,
    end_at: addDays(lastDay, 1),
    all_day: true,
  });
  const legacy = projectToLegacy(withSpanOccurrences(span, TODAY));

  assert.equal(legacy.date, TODAY);
  assert.equal(legacy.dates.length, MAX_SPAN_DAYS);
  assert.equal(legacy.dates[0], TODAY);
  assert.equal(legacy.end_date, lastDay);
});

test("withSpanOccurrences leaves one-day and collapsed events alone", () => {
  const single = canonical({
    start_at: at(TOMORROW, "19:00"),
    end_at: at(TOMORROW, "23:00"),
  });
  assert.equal(withSpanOccurrences(single, TODAY), single);

  const { events } = collapseMultiDay(
    daysFrom(TODAY, 3).map((day) =>
      canonical({
        source_id: `${day.replace(/-/g, "")}T070000Z-42@events.berkeley.edu`,
        start_at: day,
        all_day: true,
      }),
    ),
  );
  assert.equal(withSpanOccurrences(events[0], TODAY), events[0]);
});

test("dedupe meets a running span and another source's copy on today", () => {
  const exhibit = { title: "Archive Exhibit", all_day: true };
  const { events: collapsed } = collapseMultiDay(
    daysFrom(TODAY, 3).map((day) =>
      canonical({
        ...exhibit,
        source_id: `${day.replace(/-/g, "")}T070000Z-77@events.berkeley.edu`,
        start_at: day,
      }),
    ),
  );
  const bampfaSpan = withSpanOccurrences(
    canonical({
      ...exhibit,
      source_name: "bampfa",
      source_id: `archive-exhibit::${TWO_DAYS_AGO}`,
      start_at: TWO_DAYS_AGO,
      end_at: addDays(TODAY, 3),
    }),
    TODAY,
  );

  const { events, duplicatesRemoved } = dedupeEvents([
    ...collapsed,
    bampfaSpan,
  ]);
  assert.equal(duplicatesRemoved, 1);
  assert.equal(events[0].source_name, "livewhale");
});

function icsEvent(uid, lines) {
  return [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    ...lines,
    `URL:https://events.berkeley.edu/eecs/event/${uid}`,
    "END:VEVENT",
  ];
}

const icsDate = (key) => key.replace(/-/g, "");
const icsTime = (key, hhmmss) => `${icsDate(key)}T${hhmmss}Z`;

async function withStubbedFetch(respond, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => respond(String(url));
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("LiveWhale keeps multi-day events that are still running", async () => {
  // The main feed must carry at least 50 VEVENTs to count as healthy.
  const fillers = Array.from({ length: 50 }, (_, index) =>
    icsEvent(`filler-${index}`, [
      `DTSTART:${icsTime(TOMORROW, "190000")}`,
      `DTEND:${icsTime(TOMORROW, "200000")}`,
      `SUMMARY:Filler Talk ${index}`,
    ]),
  );
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//test//EN",
    ...icsEvent("conference", [
      `DTSTART:${icsTime(YESTERDAY, "190000")}`,
      `DTEND:${icsTime(TOMORROW, "230000")}`,
      "SUMMARY:Robotics Conference",
    ]),
    ...icsEvent("exhibit-week", [
      `DTSTART;VALUE=DATE:${icsDate(TWO_DAYS_AGO)}`,
      `DTEND;VALUE=DATE:${icsDate(addDays(TODAY, 5))}`,
      "SUMMARY:Archive Exhibit Week",
    ]),
    ...icsEvent("symposium", [
      `DTSTART:${icsTime(TODAY, "190000")}`,
      `DTEND:${icsTime(TOMORROW, "230000")}`,
      "SUMMARY:Climate Symposium",
    ]),
    ...icsEvent("finished", [
      `DTSTART:${icsTime(TWO_DAYS_AGO, "190000")}`,
      `DTEND:${icsTime(YESTERDAY, "230000")}`,
      "SUMMARY:Finished Workshop",
    ]),
    ...fillers.flat(),
    "END:VCALENDAR",
  ].join("\r\n");
  const emptyCalendar = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR";

  const result = await withStubbedFetch(
    (url) => ({
      ok: true,
      status: 200,
      text: async () =>
        url === "https://events.berkeley.edu/live/ical/events"
          ? ics
          : emptyCalendar,
    }),
    () => fetchLiveWhale(),
  );

  const byTitle = new Map(
    result.events.map((event) => [
      event.title,
      projectToLegacy(withSpanOccurrences(event, TODAY)),
    ]),
  );
  assert.equal(result.filteredPast, 1);
  assert.equal(byTitle.has("Finished Workshop"), false);
  assert.deepEqual(byTitle.get("Robotics Conference")?.dates, [
    TODAY,
    TOMORROW,
  ]);
  assert.deepEqual(
    byTitle.get("Archive Exhibit Week")?.dates,
    daysFrom(TODAY, 5),
  );
  assert.equal(byTitle.get("Archive Exhibit Week")?.date, TODAY);
  assert.deepEqual(byTitle.get("Climate Symposium")?.dates, [TODAY, TOMORROW]);
  assert.equal(byTitle.get("Climate Symposium")?.end_date, TOMORROW);
});

test("Tribe keeps multi-day events that are still running", async () => {
  const tribeEvent = (id, title, start, end, allDay = false) => ({
    id,
    title,
    url: `https://haas.berkeley.edu/events/${id}`,
    status: "publish",
    utc_start_date: start,
    utc_end_date: end,
    all_day: allDay,
    venue: false,
    organizer: false,
    categories: [],
  });
  const events = [
    tribeEvent(
      1,
      "Haas Conference",
      `${YESTERDAY} 19:00:00`,
      `${TOMORROW} 23:00:00`,
    ),
    // Tribe ends an all-day event at 11:59:59 PM local time.
    tribeEvent(
      2,
      "Haas Exhibit Week",
      `${TWO_DAYS_AGO} 08:00:00`,
      `${addDays(TODAY, 5)} 06:59:59`,
      true,
    ),
    tribeEvent(
      3,
      "Haas Symposium",
      `${TODAY} 19:00:00`,
      `${TOMORROW} 23:00:00`,
    ),
    tribeEvent(
      4,
      "Finished Haas Workshop",
      `${TWO_DAYS_AGO} 19:00:00`,
      `${YESTERDAY} 23:00:00`,
    ),
  ];

  const result = await withStubbedFetch(
    () => ({
      ok: true,
      status: 200,
      json: async () => ({ events, total_pages: 1 }),
    }),
    () => fetchHaas(),
  );

  const byTitle = new Map(
    result.events.map((event) => [
      event.title,
      projectToLegacy(withSpanOccurrences(event, TODAY)),
    ]),
  );
  assert.equal(result.filteredPast, 1);
  assert.equal(byTitle.has("Finished Haas Workshop"), false);
  assert.deepEqual(byTitle.get("Haas Conference")?.dates, [TODAY, TOMORROW]);
  assert.deepEqual(byTitle.get("Haas Exhibit Week")?.dates, daysFrom(TODAY, 5));
  assert.equal(byTitle.get("Haas Exhibit Week")?.end_date, addDays(TODAY, 4));
  assert.deepEqual(byTitle.get("Haas Symposium")?.dates, [TODAY, TOMORROW]);
});
