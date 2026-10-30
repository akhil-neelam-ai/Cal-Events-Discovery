/**
 * Check that the LiveWhale adapter finishes inside its time budget when
 * events.berkeley.edu is uniformly slow.
 *
 * Every request, redirect lookups included, answers only after LATENCY_MS
 * (default 14 s, just under the adapter's 15 s per-request timeout). The
 * adapter must still return within LIVEWHALE_ADAPTER_TIMEOUT_MS with all of
 * its required windows. Group feeds past their deadline are allowed to fail;
 * that is the designed degradation.
 *
 * Two cut-off paths run too: the first forward week comes back cut, so it is
 * split, and one day stays cut at every size, so it is refilled from the JSON
 * feed. Every required week must be requested and return events.
 *
 * Usage: npm run check:livewhale-budget   (about 80 s)
 */

import { addDaysToKey, todayPT } from "./lib/normalize.js";
import {
  fetchLiveWhale,
  LIVEWHALE_ADAPTER_TIMEOUT_MS,
} from "./sources/livewhale.js";

const LATENCY_MS = Number(process.env.LATENCY_MS ?? 14_000);
const today = todayPT();
const compact = (key: string) => key.replaceAll("-", "");

// A week back through about seven weeks ahead, half linking to /live/events/
// URLs so the redirect lookups run too.
const events = Array.from({ length: 400 }, (_, index) => ({
  uid: `slow-${index}`,
  date: addDaysToKey(today, (index % 50) - 3),
  url:
    index % 2
      ? `https://events.berkeley.edu/live/events/slow-${index}`
      : `https://events.berkeley.edu/econ/event/slow-${index}`,
}));

// The first forward week is cut whole; CUT_DAY stays cut even as one day.
const CUT_WEEK_START = today;
const CUT_DAY = addDaysToKey(today, 10);
const requestedWindows = new Set<string>();

function cutCalendar(body: string): string {
  const half = body.indexOf("BEGIN:VEVENT", Math.floor(body.length / 2));
  return `${half > 0 ? body.slice(0, half) : body.slice(0, 40)}BEGIN:VEVENT\r\nSUMMARY:`;
}

function jsonDay(day: string): string {
  const data = events
    .filter((event) => event.date === day)
    .map((event, index) => ({
      id: 900_000 + index,
      title: `${event.uid}-json`,
      url: event.url,
      date_utc: `${day} 19:00:00`,
      date_iso: `${day}T11:00:00-08:00`,
      date2_iso: `${day}T12:00:00-08:00`,
      is_all_day: null,
      location: null,
      description: null,
      event_types: [],
    }));
  return JSON.stringify({ meta: {}, links: { next: null }, data });
}

function calendar(rows: typeof events): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    ...rows.flatMap((event) => [
      "BEGIN:VEVENT",
      `UID:${event.uid}@events.berkeley.edu`,
      `DTSTART:${compact(event.date)}T190000Z`,
      `DTEND:${compact(event.date)}T200000Z`,
      `SUMMARY:${event.uid}`,
      `URL:${event.url}`,
      "END:VEVENT",
    ]),
    "END:VCALENDAR",
  ].join("\r\n");
}

globalThis.fetch = ((input: RequestInfo | URL, init: RequestInit = {}) =>
  new Promise<Response>((resolve, reject) => {
    const url = String(input);
    const signal = init.signal;
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("aborted"));
      return;
    }
    const timer = setTimeout(() => {
      if (init.method === "HEAD") {
        resolve(
          new Response(null, {
            status: 302,
            headers: {
              location: "https://events.berkeley.edu/Library/event/x",
            },
          }),
        );
        return;
      }
      const json =
        /\/live\/json\/events\/start_date\/(\d{4}-\d{2}-\d{2})\//.exec(url);
      if (json) {
        resolve(new Response(jsonDay(json[1]), { status: 200 }));
        return;
      }
      const window =
        /start_date\/(\d{4}-\d{2}-\d{2})\/end_date\/(\d{4}-\d{2}-\d{2})$/.exec(
          url,
        );
      if (!window) {
        resolve(new Response(calendar([]), { status: 200 }));
        return;
      }
      const [, start, end] = window;
      requestedWindows.add(start);
      const body = calendar(
        events.filter((event) => event.date >= start && event.date < end),
      );
      const isCutWeek =
        start === CUT_WEEK_START && end === addDaysToKey(start, 7);
      const holdsCutDay = start <= CUT_DAY && CUT_DAY < end;
      resolve(
        new Response(isCutWeek || holdsCutDay ? cutCalendar(body) : body, {
          status: 200,
        }),
      );
    }, LATENCY_MS);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error("aborted"));
      },
      { once: true },
    );
  })) as typeof fetch;

const log = console.log;
const warn = console.warn;
console.log = () => {};
console.warn = () => {};
const started = Date.now();
let result: Awaited<ReturnType<typeof fetchLiveWhale>>;
try {
  result = await fetchLiveWhale();
} finally {
  console.log = log;
  console.warn = warn;
}
const seconds = (Date.now() - started) / 1000;
const budgetSeconds = LIVEWHALE_ADAPTER_TIMEOUT_MS / 1000;
const requiredStart = addDaysToKey(today, -7);
const requiredEnd = addDaysToKey(today, 14);
const requiredWeeks = [requiredStart, today, addDaysToKey(today, 7)];
const requiredMissing = [
  // A required window that failed outright or stayed cut.
  ...(result.failedWindows ?? []).filter(
    (start) => start >= requiredStart && start < requiredEnd,
  ),
  // A required week that was never requested.
  ...requiredWeeks.filter((week) => !requestedWindows.has(week)),
  // A required forward week that published nothing (lookback events are
  // past, so they are filtered out by design).
  ...requiredWeeks.slice(1).filter(
    (week) =>
      !result.events.some((event) => {
        const day = event.start_at.slice(0, 10);
        return day >= week && day < addDaysToKey(week, 7);
      }),
  ),
];
const cutDayRefilled = result.events.some((event) =>
  event.title.endsWith("-json"),
);

console.log(
  JSON.stringify({
    latencyMs: LATENCY_MS,
    seconds,
    budgetSeconds,
    events: result.events.length,
    failedWindows: result.failedWindows,
    failedGroups: result.failedGroups?.length ?? 0,
    cutDayRefilled,
  }),
);

if (seconds >= budgetSeconds || requiredMissing.length > 0 || !cutDayRefilled) {
  console.error(
    `LiveWhale budget check failed: ${seconds}s of ${budgetSeconds}s, required windows missing: ${requiredMissing.join(", ") || "none"}, cut day refilled: ${cutDayRefilled}`,
  );
  process.exit(1);
}
console.log(
  `LiveWhale finished in ${seconds}s of its ${budgetSeconds}s budget.`,
);
