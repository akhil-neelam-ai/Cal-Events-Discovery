import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSearchPlan,
  searchEvents,
  tokenize,
} from "../../utils/searchEngine.ts";
import {
  addDaysToDateKey,
  getCurrentPacificDateKey,
} from "../../utils/eventDates.ts";

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
    source: "ehub",
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
    source: "ehub",
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

  assert.equal(output.plan.filters.category, "Arts");
  assert.equal(output.results[0]?.id, "evt-bampfa");
});

test("interpreted category filters use the primary displayed event tag", () => {
  const output = searchEvents(SYNTHETIC_EVENTS, "film screening", null);

  assert.equal(output.plan.filters.category, "Arts");
  assert.ok(output.results.some((event) => event.id === "evt-bampfa"));
  assert.ok(!output.results.some((event) => event.id === "evt-academic-film"));
});

test("dismissing interpreted category removes the category hard filter", () => {
  const output = searchEvents(
    SYNTHETIC_EVENTS,
    "film screening",
    null,
    new Set(["category:Arts"]),
  );

  assert.equal(output.plan.filters.category, undefined);
  assert.ok(
    !output.plan.interpretations.some((chip) => chip.key === "category:Arts"),
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
    },
    {
      ...SYNTHETIC_EVENTS[0],
      id: "evt-valid-date",
      title: "Quantum Workshop",
      date: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      description: "Quantum research workshop.",
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

test('natural-language query "artificial intelligence" applies science and tech intent', () => {
  const output = searchEvents(
    SYNTHETIC_EVENTS,
    "Artificial Intelligence",
    null,
  );

  assert.equal(output.plan.filters.category, "Science & Tech");
  assert.ok(
    output.plan.expandedTokens.includes("ai"),
    "AI synonym should be searched for the full phrase",
  );
  assert.equal(output.results[0]?.id, "evt-ai-science");
  assert.ok(!output.results.some((event) => event.id === "evt-ai-arts"));
});

test('indexed query "artificial intelligence" does not rank arts film above AI events', () => {
  const events = SYNTHETIC_EVENTS;
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

  assert.equal(output.plan.filters.category, "Science & Tech");
  assert.equal(output.results[0]?.id, "evt-ai-science");
  assert.ok(!output.results.some((event) => event.id === "evt-ai-arts"));
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
  assert.equal(output.plan.filters.category, "Entrepreneurship");
  assert.equal(output.results[0]?.id, "evt-founder");
});

test('"tonight" applies today plus evening intent and excludes all-day events', () => {
  const output = searchEvents(SYNTHETIC_EVENTS, "tonight", null);

  assert.equal(output.plan.filters.dateRange, "today");
  assert.equal(output.plan.filters.timeOfDay, "evening");
  assert.ok(output.results.some((event) => event.id === "evt-evening"));
  assert.ok(!output.results.some((event) => event.id === "evt-morning"));
  assert.ok(!output.results.some((event) => event.id === "evt-all-day"));
});

test('"today morning" preserves date intent and strips time words from keywords', () => {
  const output = searchEvents(SYNTHETIC_EVENTS, "today morning", null);

  assert.equal(output.plan.filters.dateRange, "today");
  assert.equal(output.plan.filters.timeOfDay, "morning");
  assert.deepEqual(output.plan.keywords, []);
  assert.ok(output.results.some((event) => event.id === "evt-morning"));
  assert.ok(!output.results.some((event) => event.id === "evt-evening"));
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

test("specific sport searches do not fuzzy-substitute unrelated sports", () => {
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
  assert.deepEqual(output.results, []);
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

test('"student org" is not treated as a CalLink source lock', () => {
  const plan = buildSearchPlan("student org");

  assert.equal(plan.filters.source, undefined);
  assert.equal(plan.filters.category, "Student Life");
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

  const output = searchEvents(events, "this weekend hackathon", null);

  assert.equal(output.fallbackUsed, true);
  assert.equal(output.plan.filters.dateRange, "upcoming");
  assert.equal(output.plan.filters.weekend, undefined);
  assert.equal(output.results[0]?.id, "evt-future-hackathon");
});
