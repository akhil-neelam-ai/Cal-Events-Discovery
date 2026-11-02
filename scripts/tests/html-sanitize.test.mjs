import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanTitle,
  projectToLegacy,
  restoreParagraphBreaks,
  sanitizeDescription,
  sanitizePlainText,
} from "../lib/normalize.ts";

test("sanitizePlainText decodes HTML entities and strips tags", () => {
  assert.equal(
    sanitizePlainText("Tom &amp; Jerry&#039;s &nbsp;show"),
    "Tom & Jerry's show",
  );
  assert.equal(
    sanitizePlainText("<p>Hello <strong>world</strong></p>"),
    "Hello world",
  );
});

test("sanitizePlainText drops script and style blocks with their contents", () => {
  assert.equal(
    sanitizePlainText(
      'Intro<script type="text/javascript">alert(1)</script> text<STYLE>.x{color:red}</STYLE > end',
    ),
    "Intro text end",
  );
});

test("sanitizePlainText removes remaining angle brackets", () => {
  assert.equal(sanitizePlainText("bad <<tag>> value"), "bad value");
  assert.equal(/[<>]/.test(sanitizePlainText("x < y > z")), false);
});

function canonicalEvent(overrides = {}) {
  return {
    source_name: "livewhale",
    source_id: "evt-1",
    source_url: "https://example.com/source",
    title: "Campus &amp; Community",
    description: "<p>Join us &nbsp; today</p>",
    start_at: "2026-05-30T18:00:00-07:00",
    end_at: "2026-05-30T19:00:00-07:00",
    timezone: "America/Los_Angeles",
    all_day: false,
    venue: "Campus",
    building: "",
    address: "",
    modality: "in_person",
    organizer: "Berkeley",
    organizer_unit: "",
    audience: "",
    cost: "",
    canonical_url: "https://example.com/event",
    categories: [],
    tags: ["Academic"],
    last_seen_at: "2026-05-23T12:00:00Z",
    confidence: 1,
    quality_flags: [],
    ...overrides,
  };
}

test("projectToLegacy emits clean descriptions without HTML", () => {
  const legacy = projectToLegacy(canonicalEvent());

  assert.equal(legacy.description, "Join us today");
  assert.doesNotMatch(legacy.description, /&amp;|&#|[<>]/);
});

test("projectToLegacy cleans venue and organizer text", () => {
  const legacy = projectToLegacy(
    canonicalEvent({
      source_name: "simons",
      venue: "Calvin Lab auditorium&nbsp;",
      building: "Calvin Lab\nIn-Person Event Only ",
      organizer: " &nbsp; ",
      organizer_unit: "Simons Institute &amp; SLMath",
    }),
  );

  assert.equal(
    legacy.location,
    "Calvin Lab auditorium — Calvin Lab In-Person Event Only",
  );
  assert.equal(legacy.organizer, "Simons Institute & SLMath");
});

test("projectToLegacy falls back when every venue part is blank", () => {
  const legacy = projectToLegacy(
    canonicalEvent({ venue: "&nbsp;", building: "", address: " \n " }),
  );

  assert.equal(legacy.location, "Berkeley, CA");
});

test("sanitizeDescription keeps paragraph and line breaks", () => {
  assert.equal(
    sanitizeDescription(
      "<p>First   paragraph.</p><p>Second<br>line &amp; more</p>\r\n\r\n\r\nEnd",
    ),
    "First paragraph.\nSecond\nline & more\n\nEnd",
  );
});

test("sanitizeDescription drops emphasis markers and unencodable characters", () => {
  assert.equal(
    sanitizeDescription("**Rescheduled.** Join us \uFFFD today"),
    "Rescheduled. Join us today",
  );
  assert.equal(cleanTitle("Election Day \uFFFD"), "Election Day");
});

test("restoreParagraphBreaks splits glued paragraphs but not URLs or initials", () => {
  assert.equal(
    restoreParagraphBreaks(
      "arrive early.DIRECTIONS (https://x.edu/Contact.Us)PARKING is limited.",
    ),
    "arrive early.\nDIRECTIONS (https://x.edu/Contact.Us)\nPARKING is limited.",
  );
  for (const text of [
    "Made in the U.S.A today",
    "A Ph.D. Student",
    "Write pkala@Berkeley.Edu now",
  ]) {
    assert.equal(restoreParagraphBreaks(text), text);
  }
});

test("projectToLegacy keeps description paragraphs", () => {
  const legacy = projectToLegacy(
    canonicalEvent({ description: "<p>One.</p><p>Two &nbsp; words.</p>" }),
  );

  assert.equal(legacy.description, "One.\nTwo words.");
});

test("projectToLegacy treats 12:00 AM to 11:59 PM as all day", () => {
  const legacy = projectToLegacy(
    canonicalEvent({
      start_at: "2026-10-31T00:00:00-07:00",
      end_at: "2026-10-31T23:59:00-07:00",
    }),
  );

  assert.equal(legacy.time, "All day");
  assert.equal(legacy.end_time, undefined);

  const late = projectToLegacy(
    canonicalEvent({
      start_at: "2026-10-31T00:00:00-07:00",
      end_at: "2026-10-31T01:00:00-07:00",
    }),
  );
  assert.equal(late.time, "12:00 AM");
});
