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
      const window =
        /start_date\/(\d{4}-\d{2}-\d{2})\/end_date\/(\d{4}-\d{2}-\d{2})$/.exec(
          url,
        );
      const rows = window
        ? events.filter(
            (event) => event.date >= window[1] && event.date < window[2],
          )
        : [];
      resolve(new Response(calendar(rows), { status: 200 }));
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
const requiredMissing = (result.failedWindows ?? []).filter(
  (start) => start >= requiredStart && start < requiredEnd,
);

console.log(
  JSON.stringify({
    latencyMs: LATENCY_MS,
    seconds,
    budgetSeconds,
    events: result.events.length,
    failedWindows: result.failedWindows,
    failedGroups: result.failedGroups?.length ?? 0,
  }),
);

if (seconds >= budgetSeconds || requiredMissing.length > 0) {
  console.error(
    `LiveWhale budget check failed: ${seconds}s of ${budgetSeconds}s, required windows missing: ${requiredMissing.join(", ") || "none"}`,
  );
  process.exit(1);
}
console.log(
  `LiveWhale finished in ${seconds}s of its ${budgetSeconds}s budget.`,
);
