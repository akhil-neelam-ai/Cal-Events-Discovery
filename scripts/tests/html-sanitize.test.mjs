import assert from "node:assert/strict";
import test from "node:test";

import { projectToLegacy, sanitizePlainText } from "../lib/normalize.ts";

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

test("sanitizePlainText removes remaining angle brackets", () => {
  assert.equal(sanitizePlainText("bad <<tag>> value"), "bad value");
  assert.equal(/[<>]/.test(sanitizePlainText("x < y > z")), false);
});

test("projectToLegacy emits clean descriptions without HTML", () => {
  const legacy = projectToLegacy({
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
  });

  assert.equal(legacy.description, "Join us today");
  assert.doesNotMatch(legacy.description, /&amp;|&#|[<>]/);
});
