import assert from "node:assert/strict";
import test from "node:test";

import { HttpUrlSchema } from "../../scripts/lib/schema.ts";
import {
  calendarUrlForMonth,
  gcalTokenToIso,
  isValidGCalToken,
  parseGCalLink,
  targetMonths,
} from "../../scripts/sources/bampfa.ts";
import {
  cleanSummary,
  parseGameFlags,
} from "../../scripts/sources/calbears.ts";
import { stripHtml } from "../../scripts/sources/callink.ts";
import {
  fetchCalPerformances,
  parseAddeventatcDate,
} from "../../scripts/sources/cal_performances.ts";
import { unitFromSlug } from "../../scripts/sources/livewhale.ts";
import { isoDateInPT } from "../../scripts/lib/normalize.ts";

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

test("CalLink filters by Pacific event date instead of UTC date prefix", () => {
  assert.equal(isoDateInPT("2026-04-28T06:30:00.000Z"), "2026-04-27");
  assert.equal(isoDateInPT("2026-04-28T11:30:00.000Z"), "2026-04-28");
  assert.equal(isoDateInPT("not-a-date"), "");
});

test("CalLink HTML extraction preserves comparison text", () => {
  assert.equal(
    stripHtml("Requirements: GPA > 3.0 and Age < 25"),
    "Requirements: GPA > 3.0 and Age < 25",
  );
  assert.equal(
    stripHtml(
      "<p>Welcome&nbsp;Bears<br>GPA &gt; 3.0</p><script>bad()</script>",
    ),
    "Welcome Bears GPA > 3.0",
  );
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
});
