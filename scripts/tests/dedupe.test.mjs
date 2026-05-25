import assert from "node:assert/strict";
import test from "node:test";

import { dedupeEvents } from "../../scripts/lib/dedupe.ts";

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
