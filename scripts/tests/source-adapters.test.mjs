import assert from "node:assert/strict";
import test from "node:test";

import {
  calendarUrlForMonth,
  gcalTokenToIso,
  parseGCalLink,
  targetMonths,
} from "../../scripts/sources/bampfa.ts";
import {
  cleanSummary,
  parseGameFlags,
} from "../../scripts/sources/calbears.ts";
import { parseAddeventatcDate } from "../../scripts/sources/cal_performances.ts";
import { inferEhubDate } from "../../scripts/sources/ehub.ts";
import { unitFromSlug } from "../../scripts/sources/livewhale.ts";

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

test("E-Hub infers next-year dates across year rollover only", () => {
  assert.equal(inferEhubDate("Jan 8", "2026-12-15"), "2027-01-08");
  assert.equal(inferEhubDate("Feb 3", "2026-12-15"), "2027-02-03");
  assert.equal(inferEhubDate("Mar 3", "2026-12-15"), "2026-03-03");
  assert.equal(inferEhubDate("Apr 3", "2026-04-01"), "2026-04-03");
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
