import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { DESKTOP_HERO_PRESETS } from "../../appConfig.ts";
import {
  buildSearchPlan,
  searchEvents,
  tokenize,
} from "../../utils/searchEngine.ts";
import {
  addDaysToDateKey,
  getCurrentPacificDateKey,
} from "../../utils/eventDates.ts";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const published = JSON.parse(
  fs.readFileSync(path.join(rootDir, "public", "events.json"), "utf8"),
);
const publishedSearchIndex = JSON.parse(
  fs.readFileSync(path.join(rootDir, "public", "search-index.json"), "utf8"),
);

const SYNTHETIC_EVENTS = [
  {
    id: "evt-north",
    title: "Northside Quantum Talk",
    organizer: "EECS",
    date: "2026-04-22",
    time: "5:00 PM",
    location: "Sutardja Dai Hall, Northside Berkeley",
    description: "An evening talk near Hearst and Euclid.",
    tags: ["Science & Tech"],
    url: "https://example.com/north",
    source: "livewhale",
  },
  {
    id: "evt-south",
    title: "Southside Robotics Talk",
    organizer: "Engineering",
    date: "2026-04-22",
    time: "5:00 PM",
    location: "Telegraph Avenue, Southside Berkeley",
    description: "A robotics talk on south campus.",
    tags: ["Science & Tech"],
    url: "https://example.com/south",
    source: "livewhale",
  },
  {
    id: "evt-downtown",
    title: "Downtown Founder Meetup",
    organizer: "SkyDeck",
    date: "2026-04-24",
    time: "6:00 PM",
    location: "Shattuck Avenue, Downtown Berkeley",
    description: "A startup meetup near BART.",
    tags: ["Entrepreneurship"],
    url: "https://example.com/downtown",
    source: "begin",
  },
  {
    id: "evt-bampfa",
    title: "BAMPFA Film Screening",
    organizer: "BAMPFA",
    date: "2026-04-22",
    time: "7:00 PM",
    location: "BAMPFA, 2155 Center Street",
    description: "A film screening at BAMPFA.",
    tags: ["Arts"],
    url: "https://example.com/bampfa",
    source: "bampfa",
  },
  {
    id: "evt-academic-film",
    title: "Film Screening Research Seminar",
    organizer: "Center for South Asia Studies",
    date: "2026-04-22",
    time: "3:00 PM",
    location: "Dwinelle Hall",
    description: "An academic seminar about film screening archives.",
    tags: ["Academic", "Arts"],
    url: "https://example.com/academic-film",
    source: "livewhale",
  },
  {
    id: "evt-free",
    title: "Free Student Event on Northside",
    organizer: "Student Union",
    date: "2026-04-22",
    time: "6:00 PM",
    location: "Hearst Mining Circle, Northside Berkeley",
    description: "A free student event with food near Euclid.",
    tags: ["Student Life"],
    url: "https://example.com/free",
    source: "callink",
  },
  {
    id: "evt-founder",
    title: "Founder Talk for Students",
    organizer: "SkyDeck",
    date: "2026-04-23",
    time: "4:00 PM",
    location: "Downtown Berkeley",
    description: "A startup founder talk for Berkeley students.",
    tags: ["Entrepreneurship"],
    url: "https://example.com/founder",
    source: "begin",
  },
  {
    id: "evt-ai-science",
    title: "Responsible AI and Language Models",
    organizer: "EECS",
    date: "2026-04-24",
    time: "2:00 PM",
    location: "Soda Hall",
    description:
      "A technical talk about artificial intelligence, machine learning, and language model evaluation.",
    tags: ["Science & Tech"],
    url: "https://example.com/ai-science",
    source: "livewhale",
  },
  {
    id: "evt-ai-arts",
    title: "A.I. Artificial Intelligence Film Screening",
    organizer: "BAMPFA",
    date: "2026-04-24",
    time: "7:00 PM",
    location: "BAMPFA",
    description: "A film screening about artificial intelligence.",
    tags: ["Arts"],
    url: "https://example.com/ai-arts",
    source: "bampfa",
  },
  {
    id: "evt-morning",
    title: "Morning Study Session",
    organizer: "Student Union",
    date: "2026-04-22",
    time: "9:00 AM",
    location: "MLK Student Union",
    description: "Morning study time.",
    tags: ["Student Life"],
    url: "https://example.com/morning",
    source: "callink",
  },
  {
    id: "evt-evening",
    title: "Evening Music Concert",
    organizer: "Music Department",
    date: "2026-04-22",
    time: "7:00 PM",
    location: "Hertz Hall",
    description: "An evening concert.",
    tags: ["Arts"],
    url: "https://example.com/evening",
    source: "livewhale",
  },
  {
    id: "evt-all-day",
    title: "All Day Exhibit",
    organizer: "Library",
    date: "2026-04-22",
    time: "All day",
    location: "Doe Library",
    description: "An all-day exhibit.",
    tags: ["Arts"],
    url: "https://example.com/all-day",
    source: "livewhale",
  },
  {
    id: "evt-baseball",
    title: "California Baseball vs Stanford",
    organizer: "Cal Athletics",
    date: "2026-04-24",
    time: "6:00 PM",
    location: "Evans Diamond",
    description: "A Cal Bears baseball game.",
    tags: ["Sports"],
    url: "https://example.com/baseball",
    source: "calbears",
  },
  {
    id: "evt-library",
    title: "Bancroft Library Exhibit",
    organizer: "UC Berkeley Library",
    date: "2026-04-24",
    time: "All day",
    location: "Bancroft Library",
    description: "A library exhibition with archival material.",
    tags: ["Arts"],
    url: "https://example.com/library",
    source: "livewhale",
  },
  {
    id: "evt-moffitt",
    title: "Moffitt Study Night",
    organizer: "Student Union",
    date: "2026-04-24",
    time: "8:00 PM",
    location: "Moffitt Library",
    description: "Study support in Moffitt.",
    tags: ["Student Life"],
    url: "https://example.com/moffitt",
    source: "callink",
  },
  {
    id: "evt-law",
    title: "Berkeley Law Certificate Ceremony",
    organizer: "Berkeley Law",
    date: "2026-04-24",
    time: "2:00 PM",
    location: "Law Building",
    description: "A law school ceremony.",
    tags: ["Academic"],
    url: "https://example.com/law",
    source: "berkeley_law",
  },
  {
    id: "evt-speech",
    title: "Free Speech and Public Debate",
    organizer: "Political Science",
    date: "2026-04-24",
    time: "5:00 PM",
    location: "Dwinelle Hall",
    description: "A lecture about speech rights.",
    tags: ["Academic"],
    url: "https://example.com/speech",
    source: "livewhale",
  },
];

test("structured-only temporal queries do not turn into text keywords", () => {
  const todayPlan = buildSearchPlan("today");
  const tomorrowPlan = buildSearchPlan("tomorrow");

  assert.equal(todayPlan.filters.dateRange, "today");
  assert.equal(tomorrowPlan.filters.dateRange, "tomorrow");
  assert.deepEqual(todayPlan.keywords, []);
  assert.deepEqual(tomorrowPlan.keywords, []);
});

test("tokenization normalizes accents and hyphenated terms", () => {
  assert.deepEqual(tokenize("Müller COVID-19 research"), [
    "muller",
    "covid",
    "19",
    "research",
  ]);
});

test("single-word synonyms are matched after query stemming", () => {
  const plan = buildSearchPlan("films archive");

  assert.ok(
    plan.expandedTokens.includes("movie"),
    "films should expand through the stemmed film token",
  );
  assert.ok(plan.expandedTokens.includes("cinema"));
});

test("pure temporal queries return the full pool for later date filtering", () => {
  const todayResults = searchEvents(SYNTHETIC_EVENTS, "today", null);
  const tomorrowResults = searchEvents(SYNTHETIC_EVENTS, "tomorrow", null);

  assert.equal(todayResults.results.length, SYNTHETIC_EVENTS.length);
  assert.equal(tomorrowResults.results.length, SYNTHETIC_EVENTS.length);
});

test("campus area acts as a real hard filter when interpreted", () => {
  const output = searchEvents(SYNTHETIC_EVENTS, "northside talk", null);

  assert.equal(output.plan.filters.campusArea, "northside");
  assert.deepEqual(
    output.results.map((event) => event.id),
    ["evt-north"],
  );
});

test("dismissing campus area removes the hard filter", () => {
  const output = searchEvents(
    SYNTHETIC_EVENTS,
    "northside talk",
    null,
    new Set(["campusArea:northside"]),
  );

  assert.equal(output.plan.filters.campusArea, undefined);
  assert.ok(
    !output.plan.interpretations.some(
      (chip) => chip.key === "campusArea:northside",
    ),
  );
  assert.ok(output.results.some((event) => event.id === "evt-south"));
});

test('natural-language query "film screening at bampfa" finds the BAMPFA film first', () => {
  const output = searchEvents(
    SYNTHETIC_EVENTS,
    "film screening at bampfa",
    null,
  );

  assert.equal(output.plan.filters.category, undefined);
  assert.ok(
    !output.plan.interpretations.some((chip) =>
      chip.key.startsWith("category:"),
    ),
  );
  assert.equal(output.results[0]?.id, "evt-bampfa");
});

test("film screening ranks matching events across categories", () => {
  const output = searchEvents(SYNTHETIC_EVENTS, "film screening", null);

  assert.equal(output.plan.filters.category, undefined);
  assert.ok(output.results.some((event) => event.id === "evt-bampfa"));
  assert.ok(output.results.some((event) => event.id === "evt-academic-film"));
});

test("film screening does not produce a dismissible category interpretation", () => {
  const output = searchEvents(SYNTHETIC_EVENTS, "film screening", null);

  assert.equal(output.plan.filters.category, undefined);
  assert.ok(
    !output.plan.interpretations.some((chip) =>
      chip.key.startsWith("category:"),
    ),
  );
  assert.ok(output.results.some((event) => event.id === "evt-academic-film"));
});

test("invalid event dates do not drop indexed text matches", () => {
  const events = [
    {
      ...SYNTHETIC_EVENTS[0],
      id: "evt-invalid-date",
      title: "Quantum Seminar",
      date: "not-a-real-date",
      description: "Quantum research seminar.",
      topics: ["physics-math-quantum"],
    },
    {
      ...SYNTHETIC_EVENTS[0],
      id: "evt-valid-date",
      title: "Quantum Workshop",
      date: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      description: "Quantum research workshop.",
      topics: ["physics-math-quantum"],
    },
  ];
  const index = {
    ids: events.map((event) => event.id),
    t: { quantum: [0, 1] },
    g: {},
    o: {},
    d: {},
    l: {},
    buildAt: "test",
    eventCount: events.length,
  };

  const output = searchEvents(events, "quantum", index);

  assert.deepEqual(
    output.results.map((event) => event.id),
    ["evt-valid-date", "evt-invalid-date"],
  );
});

test("recency bonus ranks a today event above an identical future event", () => {
  // Two semantically identical events differing only by date. The recency
  // bonus must favor today (day diff 0) over ~25 days out, so the today event
  // ranks first. Uses the synced Pacific day key as the clock anchor.
  const todayKey = getCurrentPacificDateKey();
  const futureKey = addDaysToDateKey(todayKey, 25);
  const events = [
    {
      id: "evt-future-symposium",
      title: "Quantum Symposium",
      organizer: "Physics",
      date: futureKey,
      time: "5:00 PM",
      location: "LeConte Hall",
      description: "A quantum physics symposium.",
      tags: ["Science & Tech"],
      topics: ["physics-math-quantum"],
      url: "https://example.com/future",
      source: "livewhale",
    },
    {
      id: "evt-today-symposium",
      title: "Quantum Symposium",
      organizer: "Physics",
      date: todayKey,
      time: "5:00 PM",
      location: "LeConte Hall",
      description: "A quantum physics symposium.",
      tags: ["Science & Tech"],
      topics: ["physics-math-quantum"],
      url: "https://example.com/today",
      source: "livewhale",
    },
  ];
  const index = {
    ids: events.map((event) => event.id),
    t: { quantum: [0, 1], symposium: [0, 1] },
    g: {},
    o: {},
    d: {},
    l: {},
    buildAt: "test",
    eventCount: events.length,
  };

  const output = searchEvents(events, "quantum symposium", index);

  assert.equal(
    output.results[0]?.id,
    "evt-today-symposium",
    "today's event should outrank the otherwise-identical future event",
  );
});

test('natural-language query "artificial intelligence" ranks AI events without category intent', () => {
  const events = SYNTHETIC_EVENTS.map((event) =>
    event.id === "evt-ai-science" || event.id === "evt-ai-arts"
      ? { ...event, topics: ["ai-machine-learning"] }
      : event,
  );
  const output = searchEvents(events, "Artificial Intelligence", null);

  assert.equal(output.plan.filters.category, undefined);
  assert.equal(output.plan.filters.topic, "ai-machine-learning");
  assert.ok(!output.plan.expandedTokens.includes("ai"));
  assert.ok(["evt-ai-science", "evt-ai-arts"].includes(output.results[0]?.id));
  assert.ok(output.results.some((event) => event.id === "evt-ai-arts"));
  assert.ok(output.results.some((event) => event.id === "evt-ai-science"));
});

test('indexed query "artificial intelligence" ranks AI events without category intent', () => {
  const events = SYNTHETIC_EVENTS.map((event) =>
    event.id === "evt-ai-science" || event.id === "evt-ai-arts"
      ? { ...event, topics: ["ai-machine-learning"] }
      : event,
  );
  const index = {
    ids: events.map((event) => event.id),
    t: {
      ai: [7],
      artificial: [8],
      intelligence: [8],
      language: [7],
      model: [7],
    },
    g: {
      science: [7],
      tech: [7],
      arts: [8],
    },
    o: {},
    d: {
      artificial: [7, 8],
      intelligence: [7, 8],
      machine: [7],
      learn: [7],
      language: [7],
      model: [7],
    },
    l: {},
    buildAt: "test",
    eventCount: events.length,
  };

  const output = searchEvents(events, "Artificial Intelligence", index);

  assert.equal(output.plan.filters.category, undefined);
  assert.equal(output.plan.filters.topic, "ai-machine-learning");
  assert.ok(["evt-ai-science", "evt-ai-arts"].includes(output.results[0]?.id));
  assert.ok(output.results.some((event) => event.id === "evt-ai-arts"));
  assert.ok(output.results.some((event) => event.id === "evt-ai-science"));
});

test('natural-language query "free events near northside" applies free and campus-area filters', () => {
  const output = searchEvents(
    SYNTHETIC_EVENTS,
    "free events near northside",
    null,
  );

  assert.equal(output.plan.filters.free, true);
  assert.equal(output.plan.filters.campusArea, "northside");
  assert.deepEqual(
    output.results.map((event) => event.id),
    ["evt-free"],
  );
});

test('natural-language query "founder talks tomorrow" preserves tomorrow intent and ranks entrepreneurship events', () => {
  const output = searchEvents(SYNTHETIC_EVENTS, "founder talks tomorrow", null);

  assert.equal(output.plan.filters.dateRange, "tomorrow");
  assert.equal(output.plan.filters.category, undefined);
  assert.equal(output.results[0]?.id, "evt-founder");
});

test('live-corpus query "AI" ranks matches across categories without category intent', () => {
  const fixture = JSON.parse(
    fs.readFileSync(
      path.join(
        rootDir,
        "scripts",
        "tests",
        "fixtures",
        "topic-reference-sets.json",
      ),
      "utf8",
    ),
  );
  const aiReferenceSet = fixture.referenceSets.find(
    (referenceSet) => referenceSet.topic === "ai-machine-learning",
  );
  const knownNonAiHomonyms = new Set([
    "livewhale_20260907T170000Z-327069@events.berkeley.edu",
    "livewhale_20260908T200000Z-328804@events.berkeley.edu",
    "berkeley_law_772656",
    "livewhale_20260925T000000Z-324717@events.berkeley.edu",
    "livewhale_20260929T210000Z-323581@events.berkeley.edu",
  ]);
  const publishedIds = new Set(published.events.map((event) => event.id));
  const referenceIds = aiReferenceSet.references
    .map((reference) => reference.id)
    .filter((id) => publishedIds.has(id) && !knownNonAiHomonyms.has(id));

  const output = searchEvents(published.events, "AI", publishedSearchIndex);
  const categories = new Set(
    output.results.map((event) => event.tags?.[0]).filter(Boolean),
  );
  const resultIds = new Set(output.results.map((event) => event.id));
  const overlap = referenceIds.filter((id) => resultIds.has(id)).length;

  assert.equal(output.plan.filters.category, undefined);
  assert.ok(
    !output.plan.interpretations.some((chip) =>
      chip.key.startsWith("category:"),
    ),
  );
  assert.ok(
    overlap >= Math.min(50, referenceIds.length),
    `AI search overlapped ${overlap}/${referenceIds.length} reference events`,
  );
  assert.ok(categories.size > 1);
});

test("topic intent uses the first subject word and preserves later words for ranking", () => {
  const events = [
    { ...SYNTHETIC_EVENTS[7], id: "topic-ai", topics: ["ai-machine-learning"] },
    { ...SYNTHETIC_EVENTS[16], id: "topic-law", topics: ["law"] },
  ];

  const aiFirst = searchEvents(events, "AI law", null);
  assert.equal(aiFirst.plan.filters.topic, "ai-machine-learning");
  assert.deepEqual(aiFirst.plan.keywords, ["law"]);
  assert.ok(
    aiFirst.plan.interpretations.some(
      (chip) => chip.key === "topic:ai-machine-learning",
    ),
  );

  const lawFirst = searchEvents(events, "law AI", null);
  assert.equal(lawFirst.plan.filters.topic, "law");
  assert.deepEqual(lawFirst.plan.keywords, ["ai"]);
});

test("free food is a free filter, not a topic or category", () => {
  const plan = buildSearchPlan("free food");

  assert.equal(plan.filters.topic, undefined);
  assert.equal(plan.filters.free, true);
  assert.equal(plan.filters.category, undefined);
});

test("free lunch is not a topic or category", () => {
  const plan = buildSearchPlan("free lunch");

  assert.equal(plan.filters.topic, undefined);
  assert.equal(plan.filters.category, undefined);
});

test("free concert keeps free plus the concert topic, not a category", () => {
  const plan = buildSearchPlan("free concert");

  assert.equal(plan.filters.topic, "music-performance");
  assert.equal(plan.filters.free, true);
  assert.equal(plan.filters.category, undefined);
});

test("later topic phrases stay ranking text, not a second hard filter", () => {
  const aiFirst = buildSearchPlan("AI film");
  assert.equal(aiFirst.filters.topic, "ai-machine-learning");
  assert.equal(aiFirst.filters.category, undefined);
  assert.ok(
    aiFirst.keywords.includes("film") || aiFirst.cleaned.includes("film"),
  );

  const filmFirst = buildSearchPlan("film AI");
  assert.equal(filmFirst.filters.topic, "film");
  assert.equal(filmFirst.filters.category, undefined);
  assert.ok(filmFirst.keywords.includes("ai"));
});

test("a fixture vocabulary that drops a synonym stops topic inference", () => {
  const topics = [
    {
      slug: "theater-dance",
      label: "Theater and Dance",
      synonyms: ["theater", "dance"],
    },
  ];
  const plan = buildSearchPlan("theatre", { topics });

  assert.equal(plan.filters.topic, undefined);
});

test("theatre resolves to Theater and Dance instead of the broad Arts category", () => {
  const plan = buildSearchPlan("theatre");

  assert.equal(plan.filters.topic, "theater-dance");
  assert.equal(plan.filters.category, undefined);
});

test("AI ethics ranks ethics-related events within the AI topic", () => {
  const events = [
    {
      ...SYNTHETIC_EVENTS[7],
      id: "topic-ethics",
      title: "AI Ethics Forum",
      topics: ["ai-machine-learning"],
    },
    {
      ...SYNTHETIC_EVENTS[7],
      id: "topic-other-ai",
      title: "AI Systems Talk",
      topics: ["ai-machine-learning"],
    },
  ];
  const output = searchEvents(events, "AI ethics", null);

  assert.equal(output.plan.filters.topic, "ai-machine-learning");
  assert.deepEqual(output.plan.keywords, ["ethic"]);
  assert.equal(output.results[0]?.id, "topic-ethics");
});

test("dismissing a topic removes its hard filter and reinjects its label for ranking", () => {
  const output = searchEvents(
    SYNTHETIC_EVENTS.map((event) => ({ ...event, topics: ["law"] })),
    "AI",
    null,
    new Set(["topic:ai-machine-learning"]),
  );

  assert.equal(output.plan.filters.topic, undefined);
  assert.deepEqual(output.plan.keywords, ["ai", "machine", "learn"]);
  assert.ok(
    output.plan.interpretations.every(
      (chip) => chip.key !== "topic:ai-machine-learning",
    ),
  );
});

test("empty topic pools broaden with an explanatory fallback", () => {
  const events = [
    {
      ...SYNTHETIC_EVENTS[7],
      id: "topic-quantum",
      title: "Quantum Talk",
      topics: ["physics-math-quantum"],
    },
  ];
  const output = searchEvents(events, "AI quantum", null);

  assert.equal(output.fallbackUsed, true);
  assert.match(output.fallbackMessage ?? "", /Showing all topics/);
  assert.equal(output.results[0]?.id, "topic-quantum");
});

test("pure-topic empty pools broaden without a search index", () => {
  const event = {
    ...SYNTHETIC_EVENTS[16],
    id: "topic-law-only",
    title: "Law Workshop",
    topics: ["law"],
  };
  const output = searchEvents([event], "AI", null);

  assert.equal(output.fallbackUsed, true);
  assert.match(output.fallbackMessage ?? "", /Showing all topics/);
  assert.deepEqual(output.results, [event]);
});

test("queries without a topic leave topic intent unset", () => {
  const plan = buildSearchPlan("seminar");
  assert.equal(plan.filters.topic, undefined);
  assert.ok(
    !plan.interpretations.some((chip) => chip.key.startsWith("topic:")),
  );
});

test("AI hero preset searches all categories", () => {
  const aiPreset = DESKTOP_HERO_PRESETS.find(
    (preset) => preset.label === "AI talks",
  );

  assert.equal(aiPreset?.category, "All");
});

test('"tonight" applies today plus evening intent and includes all-day events', () => {
  const output = searchEvents(SYNTHETIC_EVENTS, "tonight", null);

  assert.equal(output.plan.filters.dateRange, "today");
  assert.equal(output.plan.filters.timeOfDay, "evening");
  assert.ok(output.results.some((event) => event.id === "evt-evening"));
  assert.ok(!output.results.some((event) => event.id === "evt-morning"));
  assert.ok(output.results.some((event) => event.id === "evt-all-day"));
});

test('"today morning" includes all-day events', () => {
  const output = searchEvents(SYNTHETIC_EVENTS, "today morning", null);

  assert.equal(output.plan.filters.dateRange, "today");
  assert.equal(output.plan.filters.timeOfDay, "morning");
  assert.deepEqual(output.plan.keywords, []);
  assert.ok(output.results.some((event) => event.id === "evt-morning"));
  assert.ok(!output.results.some((event) => event.id === "evt-evening"));
  assert.ok(output.results.some((event) => event.id === "evt-all-day"));
});

test("all-day events match morning, afternoon, and evening filters", () => {
  for (const query of ["morning", "afternoon", "evening"]) {
    const output = searchEvents(SYNTHETIC_EVENTS, query, null);
    assert.ok(
      output.results.some((event) => event.id === "evt-all-day"),
      `expected all-day event for ${query}`,
    );
  }
});

test('"cal games" is interpreted as sports without searching for generic game text', () => {
  const output = searchEvents(SYNTHETIC_EVENTS, "cal games", null);

  assert.equal(output.plan.filters.category, "Sports");
  assert.deepEqual(output.plan.keywords, []);
  assert.deepEqual(
    output.results.map((event) => event.id),
    ["evt-baseball"],
  );
});

test("specific sport words remain category intent and are stripped", () => {
  const output = searchEvents(SYNTHETIC_EVENTS, "basketball", {
    ids: SYNTHETIC_EVENTS.map((event) => event.id),
    t: { baseball: [12] },
    g: { sport: [12] },
    o: {},
    d: {},
    l: {},
    buildAt: "test",
    eventCount: SYNTHETIC_EVENTS.length,
  });

  assert.equal(output.plan.filters.category, "Sports");
  assert.deepEqual(output.plan.keywords, []);
  assert.deepEqual(
    output.results.map((event) => event.id),
    ["evt-baseball"],
  );
});

test("venue aliases do not broaden Moffitt into every library event", () => {
  const output = searchEvents(SYNTHETIC_EVENTS, "moffitt", null);

  assert.deepEqual(
    output.results.map((event) => event.id),
    ["evt-moffitt"],
  );
});

test("source names act as source intent instead of generic text", () => {
  const output = searchEvents(SYNTHETIC_EVENTS, "berkeley law", null);

  assert.equal(output.plan.filters.source, "berkeley_law");
  assert.deepEqual(
    output.results.map((event) => event.id),
    ["evt-law"],
  );
});

test("dismissed source intent becomes literal search text instead of returning the full pool", () => {
  const output = searchEvents(
    SYNTHETIC_EVENTS,
    "berkeley law",
    null,
    new Set(["source:berkeley_law"]),
  );

  assert.equal(output.plan.filters.source, undefined);
  assert.deepEqual(output.plan.keywords, ["law"]);
  assert.ok(output.results.length < SYNTHETIC_EVENTS.length);
  assert.equal(output.results[0]?.id, "evt-law");
});

test('"berkeley ai risk" is a source lock; generic "ai risk" is not', () => {
  const locked = buildSearchPlan("berkeley ai risk");
  assert.equal(locked.filters.source, "ai_risk");

  const generic = buildSearchPlan("ai risk");
  assert.equal(generic.filters.source, undefined);
});

test('"brsl" is a source lock; generic "security lab" is not', () => {
  const locked = buildSearchPlan("brsl seminar");
  assert.equal(locked.filters.source, "brsl");

  const named = buildSearchPlan("berkeley risk and security");
  assert.equal(named.filters.source, "brsl");

  const generic = buildSearchPlan("security lab");
  assert.equal(generic.filters.source, undefined);
});

test('"student org" is not treated as a CalLink source lock', () => {
  const plan = buildSearchPlan("student org");

  assert.equal(plan.filters.source, undefined);
  assert.equal(plan.filters.category, "Student Life");
});

test("category-only words set a filter and are stripped from residual text", () => {
  const plan = buildSearchPlan("academic");

  assert.equal(plan.filters.category, "Academic");
  assert.equal(plan.cleaned, "");
  assert.deepEqual(plan.keywords, []);
});

test("future topic words remain searchable text instead of category intent", () => {
  const subjectWords = [
    "film",
    "movie",
    "concert",
    "theater",
    "dance",
    "opera",
    "recital",
    "exhibition",
    "museum",
    "poetry",
    "ai",
    "artificial intelligence",
    "machine learning",
    "language models",
    "llm",
    "data science",
    "computer science",
    "eecs",
    "robotics",
    "biotech",
    "genomics",
    "startup",
    "founder",
    "venture",
    "pitch",
    "demo day",
    "entrepreneur",
    "free food",
    "free lunch",
    "free concert",
    "club",
    "social",
    "mixer",
    "info session",
  ];

  for (const subject of subjectWords) {
    const plan = buildSearchPlan(subject);
    assert.equal(
      plan.filters.category,
      undefined,
      `${subject} should not set a category`,
    );
  }
});

test('"free speech" searches speech, not free admission', () => {
  const output = searchEvents(SYNTHETIC_EVENTS, "free speech", null);

  assert.equal(output.plan.filters.free, undefined);
  assert.deepEqual(output.plan.keywords, ["speech"]);
  assert.equal(output.results[0]?.id, "evt-speech");
  assert.ok(!output.results.some((event) => event.id === "evt-bampfa"));
});

test('"free will lecture" is not interpreted as free admission', () => {
  const events = [
    ...SYNTHETIC_EVENTS,
    {
      ...SYNTHETIC_EVENTS[16],
      id: "evt-free-will",
      title: "Free Will Lecture",
      description: "A philosophy lecture about free will.",
      tags: ["Academic"],
      source: "livewhale",
    },
  ];

  const output = searchEvents(events, "free will lecture", null);

  assert.equal(output.plan.filters.free, undefined);
  assert.equal(output.plan.filters.category, "Academic");
  assert.equal(output.results[0]?.id, "evt-free-will");
});

test("date fallback clears this-weekend hard filters when relaxing to upcoming", () => {
  const futureDate = addDaysToDateKey(getCurrentPacificDateKey(), 14);
  const events = [
    {
      ...SYNTHETIC_EVENTS[7],
      id: "evt-future-hackathon",
      title: "Future Hackathon",
      date: futureDate,
      description: "A hackathon happening after the current weekend.",
      tags: ["Science & Tech"],
    },
  ];

  const output = searchEvents(events, "this weekend hackathon future", null);

  assert.equal(output.fallbackUsed, true);
  assert.equal(output.plan.filters.dateRange, "upcoming");
  assert.equal(output.plan.filters.weekend, undefined);
  assert.equal(output.results[0]?.id, "evt-future-hackathon");
});

test("fuzzy fallback recovers a typo when the index has no exact hit", () => {
  // The index intentionally contains the event id but none of its tokens, so
  // the inverted-index phase finds nothing and the Fuse.js phase must recover
  // the match from the raw title. This mirrors production, where the fuzzy
  // phase only fires for query tokens that are absent from the index.
  const events = [SYNTHETIC_EVENTS[1]]; // "Southside Robotics Talk"
  const emptyIndex = {
    ids: ["evt-south"],
    t: {},
    g: {},
    o: {},
    d: {},
    l: {},
    buildAt: "test",
    eventCount: 1,
  };

  const output = searchEvents(events, "robotcs", emptyIndex);

  assert.ok(
    output.results.some((event) => event.id === "evt-south"),
    "expected the fuzzy fallback to recover the misspelled robotics match",
  );
});

test("category-drop fallback surfaces cross-category matches when the filtered category is empty", () => {
  // "academic research" interprets to an Academic category filter, but the
  // only keyword match here is tagged Science & Tech. The Academic-filtered
  // pool is empty, so the engine must drop the category and explain it.
  const futureDate = addDaysToDateKey(getCurrentPacificDateKey(), 5);
  const events = [
    {
      ...SYNTHETIC_EVENTS[4],
      id: "evt-doc-academic",
      title: "Research Workshop",
      organizer: "Engineering Department",
      date: futureDate,
      location: "Dwinelle Hall",
      description: "A research workshop and panel discussion.",
      tags: ["Science & Tech"],
      source: "livewhale",
    },
  ];

  const output = searchEvents(events, "academic research", null);

  assert.equal(output.plan.filters.category, "Academic");
  assert.equal(output.fallbackUsed, true);
  assert.match(output.fallbackMessage, /all categories/i);
  assert.ok(output.results.some((event) => event.id === "evt-doc-academic"));
});
