import assert from "node:assert/strict";
import test from "node:test";

import { HttpUrlSchema } from "../../scripts/lib/schema.ts";
import {
  calendarUrlForMonth,
  fetchBampfa,
  gcalTokenToIso,
  isValidGCalToken,
  parseGCalLink,
  targetMonths,
} from "../../scripts/sources/bampfa.ts";
import {
  cleanSummary,
  parseGameFlags,
} from "../../scripts/sources/calbears.ts";
import { fetchCallink } from "../../scripts/sources/callink.ts";
import {
  fetchCalPerformances,
  parseAddeventatcDate,
} from "../../scripts/sources/cal_performances.ts";
import { unitFromSlug } from "../../scripts/sources/livewhale.ts";
import {
  isoDateInPT,
  projectToLegacy,
  todayPT,
} from "../../scripts/lib/normalize.ts";

test("BAMPFA parser reads Google Calendar links", () => {
  const parsed = parseGCalLink(
    "https://calendar.google.com/calendar/r/eventedit?text=Film+Night&dates=20260422T190000/20260422T210000&details=Please+note+that+event+details+are+subject+to+change:+https%3A%2F%2Fbampfa.org%2Fevent%2Ffilm-night&location=BAMPFA",
  );

  assert.equal(parsed?.title, "Film Night");
  assert.equal(parsed?.startToken, "20260422T190000");
  assert.equal(parsed?.canonicalUrl, "https://bampfa.org/event/film-night");
  assert.equal(
    gcalTokenToIso("20260422T190000").iso,
    "2026-04-22T19:00:00-07:00",
  );
  assert.equal(
    gcalTokenToIso("20261222T190000").iso,
    "2026-12-22T19:00:00-08:00",
  );
  assert.equal(
    gcalTokenToIso("20260308T013000").iso,
    "2026-03-08T01:30:00-08:00",
  );
  assert.equal(
    gcalTokenToIso("20260308T033000").iso,
    "2026-03-08T03:30:00-07:00",
  );
  assert.deepEqual(targetMonths(new Date(2026, 10, 15)), [
    "2026-11",
    "2026-12",
    "2027-01",
    "2027-02",
  ]);
  assert.equal(
    calendarUrlForMonth("2027-01"),
    "https://bampfa.org/visit/calendar/2027-01",
  );
});

test("isValidGCalToken accepts the two real BAMPFA token shapes", () => {
  // All-day token
  assert.equal(isValidGCalToken("20260422"), true);
  // Timed token
  assert.equal(isValidGCalToken("20260422T190000"), true);
});

test("isValidGCalToken rejects future BAMPFA widget format drifts (regression: P2 #4)", () => {
  // Scenario: BAMPFA upgrades their calendar widget to emit ISO 8601 or a
  // different separator. Without validation, gcalTokenToIso's fixed-offset
  // slice() calls would produce garbage ISO strings that still pass the
  // schema's old min(8) check, corrupting published event dates.
  const drifts = [
    "2026-04-22T19:00:00", // ISO 8601 form (no separator change but slice() math is wrong)
    "20260422-190000", // dash separator instead of T
    "20260422t190000", // lowercase t
    "2026042", // truncated
    "20260422T1900", // truncated time
    "20260422T1900000", // extra digit in time
    "", // empty
    "garbage-string", // arbitrary
    "20260422 190000", // space separator
  ];
  for (const token of drifts) {
    assert.equal(
      isValidGCalToken(token),
      false,
      `isValidGCalToken must reject ${JSON.stringify(token)}`,
    );
  }
});

test("parseGCalLink rejects a link whose dates token is malformed", () => {
  // The widget drifts and emits an ISO-formatted dates token. parseGCalLink
  // must return null so the event is counted as invalid (no garbage event
  // ever reaches the canonical schema validation step).
  const parsed = parseGCalLink(
    "https://calendar.google.com/calendar/r/eventedit?text=Film+Night&dates=2026-04-22T19:00:00/2026-04-22T21:00:00&details=https%3A%2F%2Fbampfa.org%2Fevent%2Ffilm-night&location=BAMPFA",
  );
  assert.equal(parsed, null);
});

test("Cal Performances date parser preserves Pacific offsets", () => {
  assert.equal(
    parseAddeventatcDate("04/17/2026 05:30 pm"),
    "2026-04-17T17:30:00-07:00",
  );
  assert.equal(
    parseAddeventatcDate("01/17/2026 11:05 am"),
    "2026-01-17T11:05:00-08:00",
  );
});

test("Cal Performances pagination stops after the first short page", async () => {
  const originalFetch = globalThis.fetch;
  const firstPage = Array.from({ length: 100 }, (_, index) => ({
    id: index + 1,
    slug: `event-${index + 1}`,
    link: `https://example.com/event-${index + 1}`,
    title: { rendered: `Event ${index + 1}` },
    content: { rendered: "" },
  }));
  const secondPage = [
    {
      id: 101,
      slug: "event-101",
      link: "https://example.com/event-101",
      title: { rendered: "Event 101" },
      content: { rendered: "" },
    },
  ];
  const pages = [firstPage, secondPage];
  const fetchedUrls = [];

  globalThis.fetch = async (url) => {
    fetchedUrls.push(String(url));
    const page = pages.shift() ?? [];
    return {
      ok: true,
      headers: new Headers(),
      json: async () => page,
    };
  };

  try {
    const result = await fetchCalPerformances();

    assert.equal(result.rawCount, 101);
    assert.equal(result.invalid, 101);
    assert.equal(fetchedUrls.length, 2);
    assert.match(fetchedUrls[0], /page=1/);
    assert.match(fetchedUrls[1], /page=2/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function callinkEvents(count) {
  const start = new Date(Date.now() + 2 * 86_400_000);
  return Array.from({ length: count }, (_, index) => ({
    id: `evt-${index}`,
    name: `Club Meeting ${index}`,
    organizationName: "Robotics Club",
    startsOn: start.toISOString(),
    endsOn: new Date(start.getTime() + 3_600_000).toISOString(),
    visibility: "Public",
    status: "Approved",
  }));
}

async function withCallinkStub(respond, run) {
  const originalFetch = globalThis.fetch;
  const fetchedUrls = [];
  globalThis.fetch = async (url) => {
    fetchedUrls.push(new URL(String(url)));
    return {
      ok: true,
      status: 200,
      json: async () => respond(fetchedUrls.at(-1)),
    };
  };
  try {
    return { result: await run(), fetchedUrls };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("CalLink pages with take and skip until the reported count", async () => {
  // The platform serves at most 10 rows per request, whatever `take` says.
  const all = callinkEvents(30);
  const { result, fetchedUrls } = await withCallinkStub((url) => {
    const skip = Number(url.searchParams.get("skip"));
    return { "@odata.count": 30, value: all.slice(skip, skip + 10) };
  }, fetchCallink);

  assert.equal(result.events.length, 30);
  assert.deepEqual(
    fetchedUrls.map((url) => url.searchParams.get("skip")),
    ["0", "10", "20"],
  );
  assert.ok(fetchedUrls.every((url) => url.searchParams.has("take")));
  assert.ok(fetchedUrls.every((url) => !url.searchParams.has("$top")));
});

test("CalLink stops paging when the API ignores skip", async () => {
  const firstPage = callinkEvents(10);
  const { result, fetchedUrls } = await withCallinkStub(
    () => ({ "@odata.count": 30, value: firstPage }),
    fetchCallink,
  );

  assert.equal(result.events.length, 10);
  assert.equal(fetchedUrls.length, 2);
});

test("Cal Performances fetches the remaining pages in parallel", async () => {
  const originalFetch = globalThis.fetch;
  const pageSizes = [100, 100, 100, 84];
  const requested = [];
  let inFlight = 0;
  let maxInFlight = 0;

  globalThis.fetch = async (url) => {
    const page = Number(new URL(String(url)).searchParams.get("page"));
    requested.push(page);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 10));
    inFlight -= 1;
    const posts = Array.from({ length: pageSizes[page - 1] }, (_, index) => ({
      id: page * 1000 + index,
      slug: `event-${page}-${index}`,
      link: `https://example.com/event-${page}-${index}`,
      title: { rendered: `Event ${page}-${index}` },
      content: { rendered: "" },
    }));
    return {
      ok: true,
      status: 200,
      headers: new Headers({ "X-WP-TotalPages": "4" }),
      json: async () => posts,
    };
  };

  try {
    const result = await fetchCalPerformances();

    assert.equal(result.rawCount, 384);
    assert.deepEqual(requested, [1, 2, 3, 4]);
    assert.equal(maxInFlight, 3, "pages 2 to 4 should download together");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function daysFromToday(days) {
  const [year, month, day] = todayPT().split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

test("BAMPFA keeps a second showing of a film on the same day", async () => {
  const day = daysFromToday(2);
  const token = (hhmm) => `${day.replace(/-/g, "")}T${hhmm}00`;
  const link = (start, end) =>
    `<a href="https://calendar.google.com/calendar/r/eventedit?text=Film+Night&amp;dates=${token(start)}/${token(end)}&amp;details=https%3A%2F%2Fbampfa.org%2Fevent%2Ffilm-night&amp;location=BAMPFA">Add</a>`;
  // Every month page repeats the same showings, like overlapping months do.
  const html = `<html><body>${link("1900", "2100")}${link("1400", "1600")}</body></html>`;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => html,
  });
  try {
    const result = await fetchBampfa();

    assert.deepEqual(result.events.map((event) => event.source_id).sort(), [
      `film-night::${day}`,
      `film-night::${day}@1900`,
    ]);
    const first = result.events.find(
      (event) => event.source_id === `film-night::${day}`,
    );
    assert.match(first.start_at, /T14:00/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Cal Performances keeps a run listed after its first performance", async () => {
  const stamp = (key, time) => {
    const [year, month, day] = key.split("-");
    return `${month}/${day}/${year} ${time}`;
  };
  const show = (key, start, end) =>
    `<div class="addeventatc"><span class="start">${stamp(key, start)}</span><span class="end">${stamp(key, end)}</span></div>`;
  const yesterday = daysFromToday(-1);
  const tomorrow = daysFromToday(1);
  const dayAfter = daysFromToday(2);
  const post = {
    id: 501,
    slug: "dance-run",
    link: "https://calperformances.org/events/2026-27/dance/dance-run/",
    title: { rendered: "Dance Run" },
    content: {
      rendered: [
        show(yesterday, "07:30 pm", "09:30 pm"),
        show(tomorrow, "07:30 pm", "09:30 pm"),
        show(dayAfter, "02:00 pm", "04:00 pm"),
        '<a class="event-location">Zellerbach Hall</a>',
      ].join(""),
    },
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ "X-WP-TotalPages": "1" }),
    json: async () => [post],
  });
  try {
    const result = await fetchCalPerformances();

    assert.equal(result.events.length, 1);
    const legacy = projectToLegacy(result.events[0]);
    assert.equal(legacy.id, "cal_performances_501");
    assert.equal(legacy.date, tomorrow);
    assert.equal(legacy.time, "7:30 PM");
    assert.deepEqual(legacy.dates, [tomorrow, dayAfter]);
    assert.equal(legacy.end_date, dayAfter);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("CalLink filters by Pacific event date instead of UTC date prefix", () => {
  assert.equal(isoDateInPT("2026-04-28T06:30:00.000Z"), "2026-04-27");
  assert.equal(isoDateInPT("2026-04-28T11:30:00.000Z"), "2026-04-28");
  assert.equal(isoDateInPT("not-a-date"), "");
});

test("CalLink descriptions publish through the shared sanitizer", async () => {
  // The shared sanitizer drops every < and >, so a comparison loses its
  // operator. The feed keeps that rule for every source.
  const [row] = callinkEvents(1);
  const { result } = await withCallinkStub(
    () => ({
      "@odata.count": 1,
      value: [
        {
          ...row,
          description:
            "<p>Welcome&nbsp;Bears<br>GPA &gt; 3.0</p><script>bad()</script><style>.x{color:red}</style>",
        },
      ],
    }),
    fetchCallink,
  );

  const legacy = projectToLegacy(result.events[0]);
  assert.equal(legacy.description, "Welcome Bears GPA 3.0");
});

test("canonical URLs only allow HTTP(S) protocols", () => {
  assert.equal(
    HttpUrlSchema.safeParse("https://example.com/event").success,
    true,
  );
  assert.equal(
    HttpUrlSchema.safeParse("http://example.com/event").success,
    true,
  );
  assert.equal(HttpUrlSchema.safeParse("javascript:alert(1)").success, false);
  assert.equal(
    HttpUrlSchema.safeParse("data:text/html,<script>alert(1)</script>").success,
    false,
  );
});

test("Cal Bears parser strips game status flags", () => {
  assert.equal(
    cleanSummary("[H] California vs Stanford"),
    "California vs Stanford",
  );
  assert.deepEqual(parseGameFlags("[A] California at UCLA"), {
    modality: "in_person",
    isHome: false,
    isPast: false,
  });
  assert.deepEqual(parseGameFlags("[W] California vs Stanford"), {
    modality: "in_person",
    isHome: false,
    isPast: true,
  });
});

test("LiveWhale unit labels map known slugs", () => {
  assert.equal(unitFromSlug("BAMPFA"), "BAMPFA");
  assert.equal(unitFromSlug("Social Science Matrix"), "Social Science Matrix");
  assert.equal(unitFromSlug("unknown-center"), "Unknown Center");
  assert.equal(unitFromSlug("recsports"), "Recreational Sports");
});
