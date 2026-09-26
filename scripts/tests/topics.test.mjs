import assert from "node:assert/strict";
import test from "node:test";

import { FRONTEND_CATEGORIES } from "../../scripts/lib/normalize.ts";
import {
  LegacyCalEventSchema,
  PublishedEventsPayloadSchema,
  TopicVocabularySchema,
} from "../../scripts/lib/schema.ts";
import {
  assignTopics,
  TOPICS,
  TOPIC_BY_SLUG,
  TOPIC_GROUPS,
  TOPIC_SLUGS,
  TOPIC_VOCABULARY,
  TOPIC_VOCABULARY_VERSION,
} from "../../scripts/lib/topics.ts";
import {
  groupFeedsAreDegraded,
  mergeLiveWhaleFeeds,
} from "../../scripts/sources/livewhale.ts";

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

test("LiveWhale department membership assigns a field without text keywords", () => {
  assert.deepEqual(
    assignTopics(
      baseEvent({
        title: "Weekly Department Colloquium",
        description: "A faculty presentation.",
        organizer: "UC Berkeley",
        livewhale_groups: ["physics"],
      }),
    ),
    ["physics-math-quantum"],
  );
});

test("membership in two department feeds assigns both fields", () => {
  const topics = assignTopics(
    baseEvent({
      title: "Cross-listed Faculty Talk",
      description: "A faculty presentation.",
      organizer: "UC Berkeley",
      livewhale_groups: ["physics", "law"],
    }),
  );

  assert.ok(topics.includes("physics-math-quantum"));
  assert.ok(topics.includes("law"));
});

test("Recreational Sports rows do not claim the Wellness topic", () => {
  assert.deepEqual(
    assignTopics(
      baseEvent({
        title: "Building Hours - RSF",
        description: "The Recreational Sports Facility is open.",
        organizer: "Recreational Sports",
      }),
    ),
    [],
  );
});

test("a strong title signal assigns a topic without group membership", () => {
  assert.ok(
    assignTopics(
      baseEvent({
        source: "luma",
        title: "Artificial Intelligence Research Showcase",
        organizer: "Independent Student Team",
      }),
    ).includes("ai-machine-learning"),
  );
});

test("one incidental description mention stays below the confidence floor", () => {
  assert.equal(
    assignTopics(
      baseEvent({
        title: "Community Picnic",
        description: "The day includes a short mention of AI.",
        organizer: "Community Programs",
      }),
    ).includes("ai-machine-learning"),
    false,
  );
});

test("the Labor Day family event does not receive the AI topic", () => {
  assert.equal(
    assignTopics(
      baseEvent({
        title: "Five Dollar Day: Labor Day",
        organizer: "Lawrence Hall of Science",
        description:
          "Bring the family for discounted admission, animal ambassadors, biotechnology, and artificial intelligence exhibits.",
      }),
    ).includes("ai-machine-learning"),
    false,
  );
});

test("topic assignment emits only the three strongest matches", () => {
  const topics = assignTopics(
    baseEvent({
      title:
        "Law, Economics, Public Health, Artificial Intelligence, Climate, and Physics Summit",
      organizer: "UC Berkeley",
    }),
  );

  assert.equal(topics.length, 3);
  assert.deepEqual(topics, ["law", "economics-policy", "health-medicine"]);
});

test("all failed LiveWhale group feeds count as degraded provenance", () => {
  assert.equal(groupFeedsAreDegraded([]), false);
  assert.equal(groupFeedsAreDegraded([{ ok: true }, { ok: false }]), false);
  assert.equal(groupFeedsAreDegraded([{ ok: false }, { ok: false }]), true);
});

test("LiveWhale UID merge keeps every group membership on the main record", () => {
  const mainEvent = { type: "VEVENT", uid: "shared@events.berkeley.edu" };
  const groupEvent = { type: "VEVENT", uid: "shared@events.berkeley.edu" };
  const merged = mergeLiveWhaleFeeds({ main: mainEvent }, [
    { group: "physics", parsed: { physicsCopy: groupEvent } },
    { group: "law", parsed: { lawCopy: groupEvent } },
  ]);

  assert.equal(
    Object.values(merged.parsed).filter((record) => record.type === "VEVENT")
      .length,
    1,
  );
  assert.deepEqual(merged.groupsByUid.get("shared@events.berkeley.edu"), [
    "physics",
    "law",
  ]);
});

test("non-LiveWhale events assign from text without group metadata", () => {
  assert.deepEqual(
    assignTopics(
      baseEvent({
        source: "bampfa",
        title: "Film Screening: New Voices",
        organizer: "BAMPFA",
      }),
    ),
    ["film"],
  );
});

test("broad container identity does not assign without event evidence", () => {
  assert.equal(
    assignTopics(
      baseEvent({
        source: "haas",
        title: "Saturday Community Hike",
        organizer: "Berkeley Haas",
        description: "Meet at the trailhead for a campus hike.",
      }),
    ).includes("startups"),
    false,
  );
  assert.deepEqual(
    assignTopics(
      baseEvent({
        source: "bampfa",
        title: "Cafe Hours",
        organizer: "BAMPFA",
        description: "The cafe is open 11am to 4pm.",
      }),
    ),
    [],
  );
  assert.equal(
    assignTopics(
      baseEvent({
        title: "Organic Chemistry Seminar",
        organizer: "College of Chemistry",
        livewhale_groups: ["college of chemistry"],
        description: "Weekly organic chemistry seminar.",
      }),
    ).includes("biology-life-sciences"),
    false,
  );
});

test("LLM degree abbreviations do not receive the AI topic", () => {
  assert.equal(
    assignTopics(
      baseEvent({
        title: "Graduate Law Welcome Lunch",
        organizer: "Berkeley Law",
        description: "JDs, LLMs, and visiting scholars are welcome.",
      }),
    ).includes("ai-machine-learning"),
    false,
  );
});

test("topic words used in another sense do not assign their topic", () => {
  const diffusion = assignTopics(
    baseEvent({
      title:
        "Neyman Statistics Seminar with Molei Tao: Scaling Diffusion Language Models",
      organizer: "Neyman Seminar",
      description: "A test-time scaling method for diffusion language models.",
    }),
  );
  assert.equal(diffusion.includes("history-humanities"), false);
  assert.ok(diffusion.includes("ai-machine-learning"));

  assert.deepEqual(
    assignTopics(
      baseEvent({
        title:
          "Defending Democracy Online Through Social Media: Deep Fakes and Our Cognitive Security",
        organizer: "OLLI",
        description: "Social media and smartphones are changing the news.",
      }),
    ),
    [],
  );

  assert.deepEqual(
    assignTopics(
      baseEvent({
        title: "MORS Colloquium: Alex Figueroa - Practice Job Talk",
        organizer: "Berkeley Haas",
        description: "MORS Colloquium: Alex Figueroa - Practice Job Talk",
      }),
    ),
    [],
  );
});

test("the noun senses of those words still assign their topic", () => {
  for (const title of [
    "Chicago Haas Alumni Community Social",
    "Grad Student Social Hour",
    "[Queer Caucus] 1L Social Mixer",
    "Ice Cream Social on the Glade",
  ]) {
    assert.ok(
      assignTopics(baseEvent({ title, description: "" })).includes(
        "social-clubs",
      ),
      title,
    );
  }
  assert.ok(
    assignTopics(
      baseEvent({ title: "1L Job Search Panel", description: "" }),
    ).includes("career-jobs"),
  );
  assert.ok(
    assignTopics(
      baseEvent({
        title: "Language and Literature Colloquium",
        description: "",
      }),
    ).includes("history-humanities"),
  );
});
