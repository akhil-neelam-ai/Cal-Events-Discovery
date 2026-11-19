import assert from "node:assert/strict";
import test from "node:test";

import {
  DAY_PAGE_MAX_CHARS,
  cleanField,
  renderDayPage,
  renderDayPages,
} from "../dayPages.ts";

const TODAY = "2026-11-19";
const OPTIONS = { todayKey: TODAY, feedUpdatedKey: TODAY };

function makeEvent(overrides = {}) {
  const id = overrides.id ?? "evt-1";
  return {
    id,
    title: "AI Seminar",
    organizer: "Berkeley AI Lab",
    date: TODAY,
    time: "5:00 PM",
    location: "Soda Hall",
    description: "A talk.",
    tags: ["Science & Tech"],
    topics: ["ai-machine-learning"],
    url: `https://example.com/${id}`,
    source: "livewhale",
    ...overrides,
  };
}

function section(text, heading) {
  const start = text.indexOf(`## ${heading}\n`);
  if (start === -1) return [];
  const rest = text.slice(start + heading.length + 4);
  const end = rest.indexOf("\n\n");
  return (end === -1 ? rest : rest.slice(0, end)).trim().split("\n");
}

test("a normal day lists timed events by start, with a header and links", () => {
  const page = renderDayPage(
    [
      makeEvent({ id: "late", title: "Evening Talk", time: "7:00 PM" }),
      makeEvent({
        id: "early id/1",
        title: "Morning Talk",
        time: "9:00 AM",
        end_time: "10:00 AM",
      }),
      makeEvent({
        id: "other-day",
        title: "Tomorrow Talk",
        date: "2026-11-20",
      }),
    ],
    TODAY,
    OPTIONS,
  );

  const lines = page.text.split("\n");
  assert.equal(lines[0], "# UC Berkeley events on Thursday, November 19, 2026");
  assert.equal(
    lines[1],
    "From CalEvents (https://cal-events.com). Times are Pacific. 2 events. Feed updated 2026-11-19.",
  );
  assert.equal(
    lines[2],
    "Each line: time | title | place | category | topics | link",
  );
  assert.deepEqual(section(page.text, "Timed"), [
    "9:00 AM to 10:00 AM | Morning Talk | Soda Hall | Science & Tech | ai-machine-learning | https://cal-events.com/?event=early%20id%2F1",
    "7:00 PM | Evening Talk | Soda Hall | Science & Tech | ai-machine-learning | https://cal-events.com/?event=late",
  ]);
  assert.equal(page.eventCount, 2);
  assert.equal(page.leftOut, 0);
  assert.doesNotMatch(page.text, /Tomorrow Talk/);
});

test("a multi-day event shows on its days, including its last day", () => {
  const run = makeEvent({
    id: "run",
    title: "Print Exhibit",
    time: "All day",
    date: TODAY,
    end_date: "2026-11-21",
    dates: [TODAY, "2026-11-20", "2026-11-21"],
  });
  // On its last day the feed carries end_date without dates.
  const lastDay = makeEvent({
    id: "last",
    title: "Closing Day Show",
    time: "All day",
    date: TODAY,
    end_date: TODAY,
  });
  const events = [run, lastDay];

  assert.match(renderDayPage(events, TODAY, OPTIONS).text, /Print Exhibit/);
  assert.match(renderDayPage(events, TODAY, OPTIONS).text, /Closing Day Show/);
  assert.match(
    renderDayPage(events, "2026-11-21", OPTIONS).text,
    /Print Exhibit/,
  );
  assert.doesNotMatch(
    renderDayPage(events, "2026-11-20", OPTIONS).text,
    /Closing Day Show/,
  );
  assert.doesNotMatch(
    renderDayPage(events, "2026-11-22", OPTIONS).text,
    /Print Exhibit/,
  );
});

test("an all-day event sits under All day, after the timed ones", () => {
  const page = renderDayPage(
    [
      makeEvent({
        id: "exhibit",
        title: "Gallery Exhibit",
        time: "All day",
        tags: ["Arts"],
        topics: [],
      }),
      makeEvent({ id: "talk", title: "Noon Talk", time: "12:00 PM" }),
    ],
    TODAY,
    OPTIONS,
  );
  assert.deepEqual(section(page.text, "All day"), [
    "All day | Gallery Exhibit | Soda Hall | Arts | none | https://cal-events.com/?event=exhibit",
  ]);
  assert.ok(page.text.indexOf("## Timed") < page.text.indexOf("## All day"));
});

test("Rec facility schedules get one summary line instead of rows", () => {
  const rec = (id, title) =>
    makeEvent({ id, title, organizer: "Recreational Sports", time: "7:00 AM" });
  const page = renderDayPage(
    [rec("swim", "Lap Swim"), rec("rsf", "Building Hours - RSF"), makeEvent()],
    TODAY,
    OPTIONS,
  );
  assert.doesNotMatch(page.text, /Lap Swim|Building Hours/);
  assert.deepEqual(section(page.text, "Rec facility hours"), [
    "2 schedules for lap swim, open rec and building hours are not listed here.",
  ]);
  assert.match(page.text, /\. 1 event\. /);

  const one = renderDayPage([rec("swim", "Lap Swim")], TODAY, OPTIONS);
  assert.match(
    one.text,
    /1 schedule for lap swim, open rec and building hours is not listed here\./,
  );
});

test("fields lose pipes and line breaks, and long ones are trimmed", () => {
  assert.equal(
    cleanField("Exhibit | Prints\nand\r\nPosters", 110),
    "Exhibit - Prints and Posters",
  );
  assert.equal(cleanField(undefined, 10), "");

  const page = renderDayPage(
    [
      makeEvent({
        title: `Talk ${"x".repeat(200)}`,
        location: `Room ${"y".repeat(100)}`,
        tags: [],
        topics: [],
      }),
    ],
    TODAY,
    OPTIONS,
  );
  const [line] = section(page.text, "Timed");
  const [time, title, place, category, topics] = line.split(" | ");
  assert.equal(time, "5:00 PM");
  assert.equal(title.length, 110);
  assert.ok(title.endsWith("…"));
  assert.equal(place.length, 60);
  assert.ok(place.endsWith("…"));
  assert.equal(category, "none");
  assert.equal(topics, "none");
  assert.equal(line.split(" | ").length, 6);
});

test("a day over the cap shortens places, then says what it left out", () => {
  const events = Array.from({ length: 400 }, (_, index) =>
    makeEvent({
      id: `crowd-${index}`,
      title: `Crowded Day Talk ${index} ${"t".repeat(70)}`,
      location: `Hall ${index} ${"p".repeat(80)}`,
      date: "2026-11-20",
      time: "3:00 PM",
    }),
  );
  const page = renderDayPage(events, "2026-11-20", OPTIONS);

  assert.ok(
    page.text.length <= DAY_PAGE_MAX_CHARS,
    `${page.text.length} chars`,
  );
  assert.ok(page.leftOut > 0);
  assert.equal(page.eventCount, 400);
  const [first] = section(page.text, "Timed");
  assert.equal(first.split(" | ")[2].length, 30, "places shortened to 30");
  assert.deepEqual(section(page.text, "Not listed"), [
    `${page.leftOut} more events did not fit on this page. See them at https://cal-events.com/?date=tomorrow`,
  ]);
  assert.equal(section(page.text, "Timed").length, 400 - page.leftOut);
});

test("an empty day says so", () => {
  const page = renderDayPage([], "2026-11-25", {
    todayKey: TODAY,
    feedUpdatedKey: null,
  });
  assert.equal(
    page.text,
    [
      "# UC Berkeley events on Wednesday, November 25, 2026",
      "From CalEvents (https://cal-events.com). Times are Pacific. 0 events.",
      "Each line: time | title | place | category | topics | link",
      "",
      "No events are listed for this day.",
      "",
    ].join("\n"),
  );
});

test("the index lists 14 days from today with counts and links", () => {
  const { files, pages } = renderDayPages(
    [makeEvent(), makeEvent({ id: "b", date: "2026-11-20" })],
    OPTIONS,
  );
  assert.equal(pages.length, 14);
  assert.equal(files.size, 15);
  assert.ok(files.has("2026-11-19.txt"));
  assert.ok(files.has("2026-12-02.txt"));
  const index = files.get("index.txt");
  assert.match(index, /^# UC Berkeley events by day, from CalEvents\n/);
  assert.match(
    index,
    /^2026-11-19 \| Thursday \| 1 event \| https:\/\/cal-events\.com\/days\/2026-11-19\.txt$/m,
  );
  assert.match(
    index,
    /^2026-12-02 \| Wednesday \| 0 events \| https:\/\/cal-events\.com\/days\/2026-12-02\.txt$/m,
  );
});

test("Vercel serves day pages as plain text with a one-hour cache", async () => {
  const { readFileSync } = await import("node:fs");
  const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));
  const route = vercel.routes.find(
    (entry) => entry.src === "^/days/[^/]+\\.txt$",
  );
  assert.ok(route, "a /days route");
  assert.equal(route.headers["Content-Type"], "text/plain; charset=utf-8");
  assert.equal(route.headers["Cache-Control"], "public, max-age=3600");
  assert.equal(route.continue, true);
});
