import assert from "node:assert/strict";
import test from "node:test";

import { addDaysToKey, todayPT } from "../../scripts/lib/normalize.ts";
import {
  fetchLiveWhale,
  liveWhaleWindowKeys,
} from "../../scripts/sources/livewhale.ts";

const FEED = "https://events.berkeley.edu/live/ical/events";
const TODAY = todayPT();
const KEYS = liveWhaleWindowKeys(TODAY);

const compact = (key) => key.replaceAll("-", "");

/**
 * A timed event at 19:00 UTC (11 or 12 PT) or an all-day event on `date`.
 * `endDate` makes it span days.
 */
function vevent({ uid, date, endDate, allDay = false, url }) {
  const lines = ["BEGIN:VEVENT", `UID:${uid}@events.berkeley.edu`];
  if (allDay) {
    lines.push(
      `DTSTART;VALUE=DATE:${compact(date)}`,
      `DTEND;VALUE=DATE:${compact(addDaysToKey(endDate ?? date, 1))}`,
    );
  } else {
    lines.push(
      `DTSTART:${compact(date)}T190000Z`,
      `DTEND:${compact(endDate ?? date)}T200000Z`,
    );
  }
  lines.push(
    `SUMMARY:${uid}`,
    `URL:${url ?? `https://events.berkeley.edu/econ/event/${uid}`}`,
    "END:VEVENT",
  );
  return lines.join("\r\n");
}

function calendar(vevents) {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//test//EN",
    ...vevents,
    "END:VCALENDAR",
  ].join("\r\n");
}

const EMPTY = calendar([]);

function windowOf(url) {
  const match =
    /\/start_date\/(\d{4}-\d{2}-\d{2})\/end_date\/(\d{4}-\d{2}-\d{2})$/.exec(
      url,
    );
  return match ? { start: match[1], end: match[2] } : null;
}

/**
 * Mimic LiveWhale's date windows: events starting on start..end-1, plus the
 * all-day events of the end day (its end_date is exclusive only for timed
 * events).
 */
function eventsInWindow(events, { start, end }) {
  return events.filter(
    (event) =>
      (event.date >= start && event.date < end) ||
      (event.allDay && event.date === end),
  );
}

/** One event in every window, since LiveWhale never serves an empty week. */
const WEEKLY = KEYS.slice(0, -1).map((key, index) => ({
  uid: `week-${index}`,
  date: addDaysToKey(key, 3),
}));

/** 60 events tomorrow, so the required windows clear the health floor. */
const FILLERS = Array.from({ length: 60 }, (_, index) => ({
  uid: `filler-${index}`,
  date: addDaysToKey(TODAY, 1),
}));

async function withStubbedFetch(respond, run) {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const originalLog = console.log;
  const warnings = [];
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    requests.push({ url: target, method: init.method ?? "GET" });
    return respond(target, init);
  };
  console.warn = (...args) => warnings.push(args.join(" "));
  console.log = () => {};
  try {
    return { result: await run(), warnings, requests };
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    console.log = originalLog;
  }
}

function ok(body) {
  return { ok: true, status: 200, text: async () => body };
}

/**
 * Serve `events` through date windows; group feeds return an empty calendar.
 * Like LiveWhale, a window longer than one day silently stops at `cap` events.
 */
function windowServer(events, override = () => null, cap = Infinity) {
  return (url) => {
    const special = override(url);
    if (special !== null) return ok(special);
    const window = windowOf(url);
    if (!window) return ok(EMPTY);
    let served = eventsInWindow([...events, ...WEEKLY], window);
    if (window.end > addDaysToKey(window.start, 1)) {
      served = served.slice(0, cap);
    }
    return ok(calendar(served.map(vevent)));
  };
}

test("window keys run from a week back to eight weeks ahead in 7-day steps", () => {
  const keys = liveWhaleWindowKeys("2026-10-29");
  assert.equal(keys.length, 10);
  assert.equal(keys[0], "2026-10-22");
  assert.equal(keys[1], "2026-10-29");
  assert.equal(keys[2], "2026-11-05");
  assert.equal(keys.at(-1), "2026-12-24");
});

test("window keys stay on calendar dates across DST changes", () => {
  // Fall back on 2026-11-01 and spring forward on 2027-03-14.
  assert.deepEqual(liveWhaleWindowKeys("2026-10-30").slice(0, 4), [
    "2026-10-23",
    "2026-10-30",
    "2026-11-06",
    "2026-11-13",
  ]);
  assert.deepEqual(liveWhaleWindowKeys("2027-03-10").slice(0, 4), [
    "2027-03-03",
    "2027-03-10",
    "2027-03-17",
    "2027-03-24",
  ]);
});

test("LiveWhale windows lose no boundary day and publish each event once", async () => {
  const boundary = KEYS[2];
  const events = [
    ...FILLERS,
    { uid: "boundary-talk", date: boundary },
    { uid: "boundary-exhibit", date: boundary, allDay: true },
    { uid: "far-talk", date: addDaysToKey(TODAY, 50) },
    {
      uid: "running-conference",
      date: addDaysToKey(TODAY, -3),
      endDate: addDaysToKey(TODAY, 1),
    },
  ];

  const { result } = await withStubbedFetch(windowServer(events), () =>
    fetchLiveWhale(),
  );

  const count = (title) =>
    result.events.filter((event) => event.title === title).length;
  assert.equal(count("boundary-talk"), 1);
  assert.equal(count("boundary-exhibit"), 1);
  assert.equal(count("far-talk"), 1);
  assert.equal(count("running-conference"), 1);
  assert.deepEqual(result.failedWindows, []);
});

test("an incomplete window is split and both halves are published", async () => {
  const week = { start: KEYS[1], end: KEYS[2] };
  const events = [
    ...FILLERS,
    { uid: "early-week", date: addDaysToKey(week.start, 1) },
    { uid: "late-week", date: addDaysToKey(week.start, 5) },
  ];
  const truncated = (url) =>
    url === `${FEED}/start_date/${week.start}/end_date/${week.end}`
      ? calendar([vevent(FILLERS[0])]).replace(/\r\nEND:VCALENDAR$/, "")
      : null;

  const { result, requests } = await withStubbedFetch(
    windowServer(events, truncated),
    () => fetchLiveWhale(),
  );

  const titles = new Set(result.events.map((event) => event.title));
  assert.ok(titles.has("early-week"));
  assert.ok(titles.has("late-week"));
  assert.deepEqual(result.failedWindows, []);
  // The whole week was tried twice, then its halves were fetched.
  const weekUrl = `${FEED}/start_date/${week.start}/end_date/${week.end}`;
  assert.equal(requests.filter((r) => r.url === weekUrl).length, 2);
  assert.ok(
    requests.some(
      (r) =>
        r.url ===
        `${FEED}/start_date/${week.start}/end_date/${addDaysToKey(week.start, 3)}`,
    ),
  );
});

test("a required day that stays cut keeps its complete events and is reported", async () => {
  const badDay = addDaysToKey(TODAY, 2);
  const events = [
    ...FILLERS,
    { uid: "before-cut", date: badDay },
    { uid: "after-cut", date: badDay },
  ];
  // Any window holding the bad day is cut mid-event after its first event.
  const cutWhenContainingBadDay = (url) => {
    const window = windowOf(url);
    if (!window || badDay < window.start || badDay >= window.end) return null;
    return calendar([vevent(events.at(-2))]).replace(
      /END:VCALENDAR$/,
      "BEGIN:VEVENT\r\nSUMMARY:",
    );
  };

  const { result } = await withStubbedFetch(
    windowServer(events, cutWhenContainingBadDay),
    () => fetchLiveWhale(),
  );

  const titles = new Set(result.events.map((event) => event.title));
  assert.ok(titles.has("before-cut"));
  assert.ok(titles.has("filler-0"));
  assert.deepEqual(result.failedWindows, [badDay]);
});

test("a cut day is filled back in from the JSON feed", async () => {
  const badDay = addDaysToKey(TODAY, 2);
  const events = [
    ...FILLERS,
    { uid: "before-cut", date: badDay },
    { uid: "after-cut", date: badDay },
  ];
  const cut = (url) => {
    const window = windowOf(url);
    if (!window || badDay < window.start || badDay >= window.end) return null;
    return calendar([vevent(events.at(-2))]).replace(
      /END:VCALENDAR$/,
      "BEGIN:VEVENT\r\nSUMMARY:",
    );
  };
  const serveWindows = windowServer(events, cut);
  // The live shape: {meta, links, data}, 100 rows a page, array event_types.
  const jsonBase = `https://events.berkeley.edu/live/json/events/start_date/${badDay}/`;
  const pages = [
    {
      meta: { total_pages: 2 },
      links: { next: `${jsonBase}end_date/next?page=2` },
      data: [
        {
          id: 4241,
          title: "before-cut",
          url: "https://events.berkeley.edu/econ/event/before-cut",
          date_utc: `${badDay} 19:00:00`,
          date_iso: `${badDay}T11:00:00-08:00`,
          date2_iso: null,
          is_all_day: null,
          location: null,
          description: null,
          event_types: ["Exhibits", 7],
        },
      ],
    },
    {
      meta: { total_pages: 2 },
      links: { next: null },
      data: [
        {
          id: 4242,
          title: "&#127944; after-cut",
          url: "https://events.berkeley.edu/CAA/event/4242-after-cut",
          date_utc: `${badDay} 20:00:00`,
          date_iso: `${badDay}T12:00:00-08:00`,
          date2_iso: `${badDay}T15:30:00-08:00`,
          is_all_day: null,
          location: "Memorial Stadium",
          description: "<p>Watch party</p>",
          event_types: ["Athletics"],
        },
        { id: 4243, title: null },
      ],
    },
  ];
  const respond = (url) =>
    url.startsWith(jsonBase)
      ? {
          ok: true,
          status: 200,
          json: async () => (url.endsWith("?page=2") ? pages[1] : pages[0]),
        }
      : serveWindows(url);

  const { result } = await withStubbedFetch(respond, () => fetchLiveWhale());

  const refilled = result.events.find(
    (event) => event.title === "🏈 after-cut",
  );
  assert.ok(refilled);
  assert.equal(refilled.venue, "Memorial Stadium");
  assert.ok(result.events.some((event) => event.title === "before-cut"));
  assert.deepEqual(result.failedWindows, []);
});

test("an empty JSON refill leaves the cut day reported", async () => {
  const badDay = addDaysToKey(TODAY, 2);
  const events = [...FILLERS, { uid: "before-cut", date: badDay }];
  const cut = (url) => {
    const window = windowOf(url);
    if (!window || badDay < window.start || badDay >= window.end) return null;
    return calendar([vevent(events.at(-1))]).replace(
      /END:VCALENDAR$/,
      "BEGIN:VEVENT\r\nSUMMARY:",
    );
  };
  const serveWindows = windowServer(events, cut);
  const respond = (url) =>
    url.includes("/live/json/events/")
      ? {
          ok: true,
          status: 200,
          json: async () => ({ meta: {}, links: { next: null }, data: [] }),
        }
      : serveWindows(url);

  const { result } = await withStubbedFetch(respond, () => fetchLiveWhale());

  assert.ok(result.events.some((event) => event.title === "before-cut"));
  assert.deepEqual(result.failedWindows, [badDay]);
});

test("an empty week whose retry comes back cut is split, not dropped", async () => {
  const week = { start: KEYS[6], end: KEYS[7] };
  const weekUrl = `${FEED}/start_date/${week.start}/end_date/${week.end}`;
  let weekFetches = 0;
  const firstEmptyThenCut = (url) => {
    if (url !== weekUrl) return null;
    weekFetches += 1;
    return weekFetches === 1
      ? EMPTY
      : "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:";
  };

  const { result } = await withStubbedFetch(
    windowServer(FILLERS, firstEmptyThenCut),
    () => fetchLiveWhale(),
  );

  assert.ok(result.events.some((event) => event.title === "week-6"));
  assert.deepEqual(result.failedWindows, []);
});

test("a week that stays empty is reported, not silently dropped", async () => {
  const emptyStart = KEYS[6];
  const emptyWeek = (url) =>
    windowOf(url)?.start === emptyStart ? EMPTY : null;

  const { result, requests } = await withStubbedFetch(
    windowServer(FILLERS, emptyWeek),
    () => fetchLiveWhale(),
  );

  assert.deepEqual(result.failedWindows, [emptyStart]);
  // The empty week was fetched once more before it was reported.
  assert.equal(
    requests.filter((r) => windowOf(r.url)?.start === emptyStart).length,
    2,
  );
});

test("a split required window starts before queued group feeds", async () => {
  const week = { start: KEYS[1], end: KEYS[2] };
  const weekUrl = `${FEED}/start_date/${week.start}/end_date/${week.end}`;
  const serveWindows = windowServer(FILLERS, (url) =>
    url === weekUrl ? "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:" : null,
  );
  // Slow group feeds keep the pool queue full while the cut week is split.
  const respond = (url) =>
    url.includes("/group/")
      ? new Promise((resolve) => setTimeout(() => resolve(ok(EMPTY)), 300))
      : serveWindows(url);

  const { requests } = await withStubbedFetch(respond, () => fetchLiveWhale());

  const firstHalf = requests.findIndex(
    (r) =>
      r.url ===
      `${FEED}/start_date/${week.start}/end_date/${addDaysToKey(week.start, 3)}`,
  );
  const lastGroup = requests.findLastIndex((r) => r.url.includes("/group/"));
  assert.ok(firstHalf > 0, "the cut week was split");
  assert.ok(
    firstHalf < lastGroup,
    `split half at ${firstHalf} waited behind every group feed (last at ${lastGroup})`,
  );
});

test("a required window that fails outright makes LiveWhale fail", async () => {
  const errorPage = (url) =>
    windowOf(url)?.start === KEYS[1]
      ? "<html><body>Service unavailable</body></html>"
      : null;

  await assert.rejects(
    withStubbedFetch(windowServer(FILLERS, errorPage), () => fetchLiveWhale()),
    new RegExp(`required window from ${KEYS[1]} failed`),
  );
});

test("required windows below the health floor make LiveWhale fail", async () => {
  await assert.rejects(
    withStubbedFetch(windowServer(FILLERS.slice(0, 10)), () =>
      fetchLiveWhale(),
    ),
    /need ≥ 50/,
  );
});

test("a failed later window is reported and the other weeks still publish", async () => {
  const failedStart = KEYS[5];
  const events = [
    ...FILLERS,
    { uid: "later-talk", date: addDaysToKey(KEYS[6], 1) },
  ];
  const errorPage = (url) =>
    windowOf(url)?.start === failedStart
      ? "<html><body>Service unavailable</body></html>"
      : null;

  const { result, requests } = await withStubbedFetch(
    windowServer(events, errorPage),
    () => fetchLiveWhale(),
  );

  assert.deepEqual(result.failedWindows, [failedStart]);
  assert.ok(result.events.some((event) => event.title === "later-talk"));
  // An error page is not split into smaller windows.
  assert.equal(
    requests.filter((r) => windowOf(r.url)?.start === failedStart).length,
    2,
  );
});

test("a window near the feed cap is split and every event is published", async () => {
  const busy = { start: KEYS[4], end: KEYS[5] };
  const busyEvents = Array.from({ length: 1000 }, (_, index) => ({
    uid: `busy-${index}`,
    date: addDaysToKey(busy.start, index % 7),
  }));

  // The whole week stops at 930 events; its halves hold under 600 each.
  const { result } = await withStubbedFetch(
    windowServer([...FILLERS, ...busyEvents], () => null, 930),
    () => fetchLiveWhale(),
  );

  const busyTitles = new Set(
    result.events
      .filter((event) => event.title.startsWith("busy-"))
      .map((event) => event.title),
  );
  assert.equal(busyTitles.size, 1000);
});

test("a cut-off group feed is filled from the JSON group feed", async () => {
  const day = addDaysToKey(TODAY, 4);
  const cutGroup = (url) =>
    url.endsWith("/group/ASUC%20Student%20Union")
      ? "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nSUMMARY:"
      : null;
  const serve = windowServer(FILLERS, cutGroup);
  const respond = (url) =>
    url.includes("/live/json/events/group/ASUC%20Student%20Union/")
      ? {
          ok: true,
          status: 200,
          json: async () => ({
            meta: { total_pages: 1 },
            links: { next: null },
            data: [
              {
                id: 5150,
                title: "CrafterDark at Anchor House",
                url: "https://events.berkeley.edu/ASUC/event/5150-crafterdark",
                date_utc: `${day} 02:00:00`,
                date_iso: `${day}T18:00:00-08:00`,
                date2_iso: `${day}T21:00:00-08:00`,
                is_all_day: null,
                location: "Anchor House",
                description: null,
                event_types: ["Social"],
              },
            ],
          }),
        }
      : serve(url);

  const { result } = await withStubbedFetch(respond, () => fetchLiveWhale());

  const crafter = result.events.find(
    (event) => event.title === "CrafterDark at Anchor House",
  );
  assert.ok(crafter);
  assert.deepEqual(crafter.livewhale_groups, ["ASUC Student Union"]);
  assert.deepEqual(result.failedGroups, []);
});

test("a cut-off group feed counts as a failed group", async () => {
  const cutGroup = (url) =>
    url.endsWith("/group/physics")
      ? "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nSUMMARY:"
      : null;

  const { result } = await withStubbedFetch(
    windowServer(FILLERS, cutGroup),
    () => fetchLiveWhale(),
  );

  assert.deepEqual(result.failedGroups, ["physics"]);
});

/** HEAD requests to /live/events/<id> redirect to a unit URL. */
function redirectingServer(events) {
  const serve = windowServer(events);
  return (url, init) => {
    if (init.method === "HEAD") {
      return {
        ok: false,
        status: 302,
        headers: new Headers({
          location: `https://events.berkeley.edu/Library/event/${url.split("/").pop()}`,
        }),
      };
    }
    return serve(url);
  };
}

test("redirects are resolved only for events that have not ended", async () => {
  const events = [
    ...FILLERS,
    {
      uid: "ended-talk",
      date: addDaysToKey(TODAY, -2),
      url: "https://events.berkeley.edu/live/events/ended-talk-1",
    },
    {
      uid: "upcoming-talk",
      date: addDaysToKey(TODAY, 2),
      url: "https://events.berkeley.edu/live/events/upcoming-talk-1",
    },
  ];

  const { result, requests } = await withStubbedFetch(
    redirectingServer(events),
    () => fetchLiveWhale(),
  );

  const heads = requests.filter((r) => r.method === "HEAD").map((r) => r.url);
  assert.deepEqual(heads, [
    "https://events.berkeley.edu/live/events/upcoming-talk-1",
  ]);
  // The redirect gave the event its unit instead of the generic fallback.
  assert.notEqual(
    result.events.find((event) => event.title === "upcoming-talk")?.organizer,
    "UC Berkeley",
  );
});

test("each redirect is resolved once even past 500 unique URLs", async () => {
  const linked = Array.from({ length: 600 }, (_, index) => ({
    uid: `linked-${index}`,
    date: addDaysToKey(TODAY, 8 + (index % 40)),
    url: `https://events.berkeley.edu/live/events/linked-${index}`,
  }));

  const { requests } = await withStubbedFetch(
    redirectingServer([...FILLERS, ...linked]),
    () => fetchLiveWhale(),
  );

  const perUrl = new Map();
  for (const r of requests.filter((r) => r.method === "HEAD")) {
    perUrl.set(r.url, (perUrl.get(r.url) ?? 0) + 1);
  }
  assert.equal(perUrl.size, 600);
  assert.ok([...perUrl.values()].every((n) => n === 1));
});
