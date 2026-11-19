/**
 * Day pages for AI assistants: one small plain-text page per day for the next
 * 14 days, plus an index, written to public/days/ at build time. An assistant
 * that can only fetch pages reads about 40,000 characters at a time, a few
 * percent of events.json, so each page stays under 36,000 characters.
 *
 * Which events fall on a day comes from the app's own date logic, the same
 * check the UI's Tomorrow view uses.
 */
import fs from "node:fs";
import path from "node:path";

import type { CalEvent } from "../types";
import {
  addDaysToDateKey,
  clockMinutes,
  firstOccurrenceInRange,
  getCurrentPacificDateKey,
  sortEventsChronologically,
  weekEndKey,
} from "../utils/eventDates";
import {
  isRecFacilitySchedule,
  shortenVenue,
} from "../utils/eventPresentation";

export const SITE_URL = "https://cal-events.com";
export const DAY_PAGE_COUNT = 14;
export const DAY_PAGE_MAX_CHARS = 36_000;

const TITLE_MAX = 110;
const PLACE_MAX = 60;
// The first step when a day runs over the cap.
const SHORT_PLACE_MAX = 30;

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function keyParts(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const weekday =
    WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return { year, month: MONTHS[month - 1], day, weekday };
}

/**
 * One line per field: no line breaks, and an ellipsis past `max`. A pipe
 * would split the field, so "Exhibit | Prints" reads "Exhibit - Prints".
 */
export function cleanField(text: string | undefined, max: number): string {
  const flat = (text ?? "")
    .replace(/\s*\|+\s*/g, " - ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

export function eventLink(id: string): string {
  return `${SITE_URL}/?event=${encodeURIComponent(id)}`;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function timeField(event: CalEvent): string {
  if (clockMinutes(event.time) === null) {
    return cleanField(event.time, 40) || "All day";
  }
  return event.end_time ? `${event.time} to ${event.end_time}` : event.time;
}

function eventLine(event: CalEvent, placeMax: number): string {
  const place = cleanField(shortenVenue(event.location ?? ""), placeMax);
  const topics = (event.topics ?? []).join(", ");
  return [
    timeField(event),
    cleanField(event.title, TITLE_MAX),
    place || "none",
    cleanField(event.tags?.[0], 40) || "none",
    cleanField(topics, 120) || "none",
    eventLink(event.id),
  ].join(" | ");
}

/** The site view that shows a day, for events a page had to leave out. */
function siteLinkForDay(dayKey: string, todayKey: string): string {
  if (dayKey === todayKey) return `${SITE_URL}/?date=today`;
  if (dayKey === addDaysToDateKey(todayKey, 1)) {
    return `${SITE_URL}/?date=tomorrow`;
  }
  if (dayKey <= weekEndKey(todayKey)) return `${SITE_URL}/?date=week`;
  return `${SITE_URL}/?date=upcoming`;
}

export interface DayPage {
  dateKey: string;
  text: string;
  /** Events on the day, not counting Rec facility schedules. */
  eventCount: number;
  /** Events the size cap left off the page. */
  leftOut: number;
}

export function renderDayPage(
  events: readonly CalEvent[],
  dayKey: string,
  {
    todayKey,
    feedUpdatedKey,
  }: { todayKey: string; feedUpdatedKey: string | null },
): DayPage {
  const onDay = events.filter(
    (event) => firstOccurrenceInRange(event, dayKey, dayKey) !== null,
  );
  const recCount = onDay.filter(isRecFacilitySchedule).length;
  const listed = sortEventsChronologically(
    onDay.filter((event) => !isRecFacilitySchedule(event)),
    dayKey,
  );
  const timed = listed.filter((event) => clockMinutes(event.time) !== null);
  const allDay = listed.filter((event) => clockMinutes(event.time) === null);

  const { year, month, day, weekday } = keyParts(dayKey);
  const head = [
    `# UC Berkeley events on ${weekday}, ${month} ${day}, ${year}`,
    [
      `From CalEvents (${SITE_URL}). Times are Pacific.`,
      `${plural(listed.length, "event")}.`,
      feedUpdatedKey ? `Feed updated ${feedUpdatedKey}.` : "",
    ]
      .filter(Boolean)
      .join(" "),
    "Each line: time | title | place | category | topics | link",
  ].join("\n");
  const rec =
    recCount > 0
      ? `\n\n## Rec facility hours\n${plural(recCount, "schedule")} for lap swim, open rec and building hours ${recCount === 1 ? "is" : "are"} not listed here.`
      : "";

  const compose = (placeMax: number, keep: number) => {
    const timedLines = timed
      .slice(0, keep)
      .map((event) => eventLine(event, placeMax));
    const allDayLines = allDay
      .slice(0, Math.max(keep - timed.length, 0))
      .map((event) => eventLine(event, placeMax));
    const sections = [
      timedLines.length ? `## Timed\n${timedLines.join("\n")}` : "",
      allDayLines.length ? `## All day\n${allDayLines.join("\n")}` : "",
    ].filter(Boolean);
    const body =
      listed.length === 0
        ? "No events are listed for this day."
        : sections.join("\n\n");
    const leftOut = listed.length - keep;
    const footer =
      leftOut > 0
        ? `\n\n## Not listed\n${plural(leftOut, "more event")} did not fit on this page. See them at ${siteLinkForDay(dayKey, todayKey)}`
        : "";
    return `${head}\n\n${body}${rec}${footer}\n`;
  };

  // Over the cap, shorten places first, then leave events off the end.
  let text = compose(PLACE_MAX, listed.length);
  let keep = listed.length;
  if (text.length > DAY_PAGE_MAX_CHARS) {
    text = compose(SHORT_PLACE_MAX, keep);
    while (text.length > DAY_PAGE_MAX_CHARS && keep > 0) {
      keep -= 1;
      text = compose(SHORT_PLACE_MAX, keep);
    }
  }

  return {
    dateKey: dayKey,
    text,
    eventCount: listed.length,
    leftOut: listed.length - keep,
  };
}

export function renderDayIndex(
  pages: readonly DayPage[],
  feedUpdatedKey: string | null,
): string {
  const lines = pages.map(
    (page) =>
      `${page.dateKey} | ${keyParts(page.dateKey).weekday} | ${plural(page.eventCount, "event")} | ${SITE_URL}/days/${page.dateKey}.txt`,
  );
  return [
    "# UC Berkeley events by day, from CalEvents",
    `Each page below lists one day of UC Berkeley campus events from CalEvents (${SITE_URL}), for the next ${pages.length} days. A page is small enough to read in one fetch. Read the pages for the days you need, and share each event by the link on its line.${feedUpdatedKey ? ` Times are Pacific. Feed updated ${feedUpdatedKey}.` : " Times are Pacific."}`,
    "Each line: date | weekday | events | page",
    "",
    ...lines,
    "",
  ].join("\n");
}

/** Every page, keyed by file name, starting from `todayKey`. */
export function renderDayPages(
  events: readonly CalEvent[],
  {
    todayKey,
    feedUpdatedKey,
    days = DAY_PAGE_COUNT,
  }: { todayKey: string; feedUpdatedKey: string | null; days?: number },
): { files: Map<string, string>; pages: DayPage[] } {
  const pages = Array.from({ length: days }, (_, offset) =>
    renderDayPage(events, addDaysToDateKey(todayKey, offset), {
      todayKey,
      feedUpdatedKey,
    }),
  );
  const files = new Map<string, string>([
    ["index.txt", renderDayIndex(pages, feedUpdatedKey)],
  ]);
  for (const page of pages) files.set(`${page.dateKey}.txt`, page.text);
  return { files, pages };
}

/**
 * Reads public/events.json and replaces public/days/. Runs from the Vite
 * plugin in vite.config.ts at the start of every build and dev server.
 */
export function writeDayPages(rootDir: string, now = new Date()) {
  const feedPath = path.join(rootDir, "public", "events.json");
  const feed = JSON.parse(fs.readFileSync(feedPath, "utf8")) as {
    events: CalEvent[];
    lastUpdated?: number | null;
  };
  const feedUpdatedKey =
    typeof feed.lastUpdated === "number"
      ? getCurrentPacificDateKey(new Date(feed.lastUpdated))
      : null;
  const { files, pages } = renderDayPages(feed.events, {
    todayKey: getCurrentPacificDateKey(now),
    feedUpdatedKey,
  });

  const outDir = path.join(rootDir, "public", "days");
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  for (const [name, text] of files) {
    fs.writeFileSync(path.join(outDir, name), text);
  }
  return {
    pages,
    largest: Math.max(...pages.map((page) => page.text.length)),
  };
}
