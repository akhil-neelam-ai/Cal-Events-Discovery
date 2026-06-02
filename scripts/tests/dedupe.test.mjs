import assert from "node:assert/strict";
import test from "node:test";

import { dedupeEvents } from "../../scripts/lib/dedupe.ts";
import { normalizeForDedupe } from "../../scripts/lib/normalize.ts";

function event(overrides) {
  return {
    source_name: "ehub",
    source_id: "event-1",
    source_url: "https://example.com/source/event-1",
    title: "Sample Event",
    description: "",
    start_at: "2026-05-10T12:00:00-07:00",
    timezone: "America/Los_Angeles",
    all_day: false,
    venue: "",
    building: "",
    address: "",
    modality: "in_person",
    organizer: "",
    organizer_unit: "",
    audience: "",
    cost: "",
    canonical_url: "https://example.com/events/event-1",
    categories: [],
    tags: [],
    last_seen_at: "2026-05-04T12:00:00Z",
    confidence: 1,
    quality_flags: [],
    ...overrides,
  };
}

test("dedupe keeps empty normalized titles distinct by stable source identity", () => {
  const first = event({
    source_name: "ehub",
    source_id: "punctuation-1",
    title: "!!!",
    source_url: "https://example.com/source/punctuation-1",
    canonical_url: "https://example.com/events/punctuation-1",
  });
  const second = event({
    source_name: "bampfa",
    source_id: "punctuation-2",
    title: "???",
    source_url: "https://example.com/source/punctuation-2",
    canonical_url: "https://example.com/events/punctuation-2",
  });

  const result = dedupeEvents([first, second]);

  assert.equal(result.duplicatesRemoved, 0);
  assert.deepEqual(
    result.events.map((dedupedEvent) => dedupedEvent.source_id),
    ["punctuation-1", "punctuation-2"],
  );
});

test("dedupe preserves source priority for normal title and date duplicates", () => {
  const lowerPriority = event({
    source_name: "ehub",
    source_id: "ehub-lecture",
    title: "The Spring Lecture",
    source_url: "https://example.com/source/ehub-lecture",
    canonical_url: "https://example.com/events/ehub-lecture",
  });
  const higherPriority = event({
    source_name: "livewhale",
    source_id: "livewhale-lecture",
    title: "Spring Lecture",
    source_url: "https://example.com/source/livewhale-lecture",
    canonical_url: "https://example.com/events/livewhale-lecture",
  });

  const result = dedupeEvents([lowerPriority, higherPriority]);

  assert.equal(result.duplicatesRemoved, 1);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].source_id, "livewhale-lecture");
});

test("dedupe resolves same-priority collisions deterministically (first seen wins)", () => {
  const first = event({
    source_name: "callink",
    source_id: "callink-mixer",
    title: "Spring Mixer",
    source_url: "https://example.com/source/callink-mixer",
    canonical_url: "https://example.com/events/callink-mixer",
  });
  const second = event({
    source_name: "bampfa",
    source_id: "bampfa-mixer",
    title: "Spring Mixer",
    source_url: "https://example.com/source/bampfa-mixer",
    canonical_url: "https://example.com/events/bampfa-mixer",
  });

  // Both callink and bampfa carry equal source priority. The winner must not
  // depend on input order flipping the result — first seen is retained.
  const forward = dedupeEvents([first, second]);
  const reversed = dedupeEvents([second, first]);

  assert.equal(forward.duplicatesRemoved, 1);
  assert.equal(forward.events[0].source_id, "callink-mixer");
  assert.equal(reversed.duplicatesRemoved, 1);
  assert.equal(reversed.events[0].source_id, "bampfa-mixer");
});

test("dedupe keeps same-title events on different dates distinct", () => {
  const monday = event({
    source_name: "livewhale",
    source_id: "weekly-monday",
    title: "Weekly Seminar",
    start_at: "2026-05-11T16:00:00-07:00",
    source_url: "https://example.com/source/weekly-monday",
    canonical_url: "https://example.com/events/weekly-monday",
  });
  const tuesday = event({
    source_name: "livewhale",
    source_id: "weekly-tuesday",
    title: "Weekly Seminar",
    start_at: "2026-05-12T16:00:00-07:00",
    source_url: "https://example.com/source/weekly-tuesday",
    canonical_url: "https://example.com/events/weekly-tuesday",
  });

  const result = dedupeEvents([monday, tuesday]);

  assert.equal(result.duplicatesRemoved, 0);
  assert.deepEqual(
    result.events.map((dedupedEvent) => dedupedEvent.source_id).sort(),
    ["weekly-monday", "weekly-tuesday"],
  );
});

test("normalizeForDedupe strips stopwords, punctuation, and case", () => {
  assert.equal(
    normalizeForDedupe("The Spring Lecture of Music"),
    "spring lecture music",
  );
  // Stopword-equivalent titles collapse to the same key so they dedupe.
  assert.equal(
    normalizeForDedupe("Career Fair & Networking"),
    normalizeForDedupe("Career Fair and Networking"),
  );
  // A title made entirely of stopwords/punctuation normalizes to empty,
  // which forces dedupe to fall back to stable source identity.
  assert.equal(normalizeForDedupe("The & Of !!!"), "");
});
