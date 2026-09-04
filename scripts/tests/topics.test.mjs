import assert from "node:assert/strict";
import test from "node:test";

import { FRONTEND_CATEGORIES } from "../../scripts/lib/normalize.ts";
import {
  LegacyCalEventSchema,
  PublishedEventsPayloadSchema,
  TopicVocabularySchema,
} from "../../scripts/lib/schema.ts";
import {
  TOPICS,
  TOPIC_BY_SLUG,
  TOPIC_GROUPS,
  TOPIC_SLUGS,
  TOPIC_VOCABULARY,
  TOPIC_VOCABULARY_VERSION,
} from "../../scripts/lib/topics.ts";

function baseEvent(overrides = {}) {
  return {
    id: "livewhale_evt-1",
    title: "Sample Berkeley Event",
    organizer: "UC Berkeley",
    date: "2026-09-10",
    time: "12:00 PM",
    location: "Berkeley, CA",
    description: "A sample event.",
    tags: ["Academic"],
    url: "https://events.berkeley.edu/event/evt-1",
    source: "livewhale",
    ...overrides,
  };
}

function basePayload(event) {
  return {
    events: [event],
    sources: [
      {
        title: "UC Berkeley Events",
        uri: "https://events.berkeley.edu/",
      },
    ],
    lastUpdated: Date.parse("2026-09-04T12:00:00Z"),
    data_age_hours: 0,
    degraded_sources: [],
    topic_vocabulary: TOPIC_VOCABULARY,
  };
}

test("topic vocabulary has stable unique URL-safe slugs", () => {
  assert.equal(TOPIC_VOCABULARY_VERSION, 1);
  assert.equal(TOPIC_VOCABULARY.version, TOPIC_VOCABULARY_VERSION);
  assert.equal(TOPIC_SLUGS.length, TOPICS.length);
  assert.equal(new Set(TOPIC_SLUGS).size, TOPIC_SLUGS.length);

  for (const topic of TOPICS) {
    assert.match(topic.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.equal(TOPIC_BY_SLUG.get(topic.slug), topic);
  }
});

test("topic slugs and labels do not collide with categories", () => {
  const categories = new Set(
    FRONTEND_CATEGORIES.map((category) => category.toLocaleLowerCase()),
  );

  for (const topic of TOPICS) {
    assert.equal(categories.has(topic.slug.toLocaleLowerCase()), false);
    assert.equal(categories.has(topic.label.toLocaleLowerCase()), false);
  }
});

test("every topic belongs to one known group", () => {
  assert.deepEqual(TOPIC_GROUPS, ["fields", "interests"]);

  for (const topic of TOPICS) {
    assert.equal(TOPIC_GROUPS.includes(topic.group), true);
  }
});

test("topic synonyms are present and claimed by one topic", () => {
  const claimedSynonyms = new Map();

  for (const topic of TOPICS) {
    assert.ok(topic.synonyms.length > 0, `${topic.slug} needs a synonym`);

    for (const synonym of topic.synonyms) {
      const normalized = synonym.trim().toLocaleLowerCase();
      assert.ok(normalized.length > 0, `${topic.slug} has a blank synonym`);
      assert.equal(
        claimedSynonyms.has(normalized),
        false,
        `${JSON.stringify(synonym)} is claimed by ${claimedSynonyms.get(normalized)} and ${topic.slug}`,
      );
      claimedSynonyms.set(normalized, topic.slug);
    }
  }
});

test("published vocabulary matches its schema", () => {
  const result = TopicVocabularySchema.safeParse(TOPIC_VOCABULARY);
  assert.equal(result.success, true);
});

test("published payload accepts events with and without topics", () => {
  const withoutTopics = PublishedEventsPayloadSchema.safeParse(
    basePayload(baseEvent()),
  );
  const withTopics = PublishedEventsPayloadSchema.safeParse(
    basePayload(baseEvent({ topics: ["law"] })),
  );

  assert.equal(withoutTopics.success, true);
  assert.equal(withTopics.success, true);
});

test("published events accept up to three topics and reject four", () => {
  assert.equal(
    LegacyCalEventSchema.safeParse(
      baseEvent({
        topics: ["law", "economics-policy", "health-medicine"],
      }),
    ).success,
    true,
  );
  assert.equal(
    LegacyCalEventSchema.safeParse(
      baseEvent({
        topics: [
          "law",
          "economics-policy",
          "health-medicine",
          "history-humanities",
        ],
      }),
    ).success,
    false,
  );
});

test("published events reject unknown and duplicate topic slugs", () => {
  assert.equal(
    LegacyCalEventSchema.safeParse(baseEvent({ topics: ["unknown-topic"] }))
      .success,
    false,
  );
  assert.equal(
    LegacyCalEventSchema.safeParse(baseEvent({ topics: ["law", "law"] }))
      .success,
    false,
  );
});
