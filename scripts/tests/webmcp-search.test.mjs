import assert from "node:assert/strict";
import test from "node:test";

import { createWebMcpTools } from "../../agent/webmcpTools.ts";
import {
  ACTIVE_SOURCES,
  Categories,
  RETIRED_SOURCES,
} from "../../appConfig.ts";
import { buildSearchIndex } from "../../scripts/lib/buildIndex.ts";
import {
  RETIRED_SOURCES as SCHEMA_RETIRED_SOURCES,
  SourceNameSchema,
} from "../../scripts/lib/schema.ts";
import {
  addDaysToDateKey,
  getCurrentPacificDateKey,
} from "../../utils/eventDates.ts";

function inDays(days) {
  return addDaysToDateKey(getCurrentPacificDateKey(), days);
}

function event(overrides = {}) {
  return {
    id: overrides.id ?? "event",
    title: overrides.title ?? "AI Event",
    organizer: "UC Berkeley",
    date: overrides.date ?? inDays(1),
    // Late enough that a today event has not ended while the suite runs.
    time: overrides.time ?? "All day",
    location: "Sather Gate",
    description: overrides.description ?? "",
    tags: overrides.tags ?? ["Arts"],
    topics: overrides.topics,
    url: "https://example.com",
    source: overrides.source ?? "livewhale",
  };
}

function loadSearch(events, extra = {}) {
  const payload = { lastUpdated: 1, events, ...extra };
  const tools = createWebMcpTools({
    fetchJson: async (requestPath) => {
      if (requestPath === "/events.json") return payload;
      if (requestPath === "/search-index.json") return buildSearchIndex(events);
      throw new Error(`unexpected path ${requestPath}`);
    },
    getLocationSearch: () => "",
    getOrigin: () => "https://cal-events.com",
    applyUrlSearch: () => {},
  });
  return tools.find((tool) => tool.name === "search_berkeley_events");
}

const ids = (output) => output.events.map((item) => item.id);

test("concerts tomorrow searches only tomorrow, like the UI", async () => {
  const search = loadSearch([
    event({ id: "today", title: "Jazz Concert", date: inDays(0) }),
    event({ id: "tomorrow", title: "Choir Concert", date: inDays(1) }),
    event({ id: "later", title: "Piano Concert", date: inDays(3) }),
  ]);

  const output = await search.execute({ query: "concerts tomorrow" });
  assert.deepEqual(ids(output), ["tomorrow"]);
});

test("search reports the query's date chip and the range it searched", async () => {
  const search = loadSearch([
    event({ id: "tomorrow", title: "Choir Concert", date: inDays(1) }),
  ]);

  const output = await search.execute({ query: "concerts tomorrow" });
  assert.deepEqual(output.interpretations, [
    { key: "dateRange:tomorrow", label: "Tomorrow" },
  ]);
  assert.deepEqual(output.effectiveDateRange, {
    preset: "tomorrow",
    startDate: inDays(1),
    endDate: inDays(1),
    basis: "query",
    requested: "tomorrow",
    widened: false,
  });
});

test("an explicit date overrides the query's date", async () => {
  const search = loadSearch([
    event({ id: "tomorrow", title: "Choir Concert", date: inDays(1) }),
    event({ id: "later", title: "Piano Concert", date: inDays(3) }),
  ]);

  const output = await search.execute({
    query: "concerts tomorrow",
    datePreset: "week",
  });
  assert.deepEqual(new Set(ids(output)), new Set(["tomorrow", "later"]));
  assert.equal(output.effectiveDateRange.basis, "input");
});

test("with no date anywhere, search runs from today with no end", async () => {
  const search = loadSearch([
    event({ id: "soon", title: "Jazz Concert", date: inDays(2) }),
    event({ id: "far", title: "Jazz Night", date: inDays(30) }),
  ]);

  const output = await search.execute({ query: "jazz" });
  assert.deepEqual(new Set(ids(output)), new Set(["soon", "far"]));
  assert.deepEqual(output.effectiveDateRange, {
    preset: "upcoming",
    startDate: inDays(0),
    endDate: null,
    basis: "default",
    requested: "upcoming",
    widened: false,
  });
});

test("a query's today widens to the week when today has no match", async () => {
  const search = loadSearch([
    event({ id: "today-other", title: "Pottery Night", date: inDays(0) }),
    event({ id: "jazz-later", title: "Jazz Concert", date: inDays(2) }),
    event({ id: "jazz-far", title: "Jazz Festival", date: inDays(10) }),
  ]);

  const output = await search.execute({ query: "jazz today" });
  assert.deepEqual(ids(output), ["jazz-later"]);
  assert.equal(output.effectiveDateRange.preset, "week");
  assert.equal(output.effectiveDateRange.requested, "today");
  assert.equal(output.effectiveDateRange.widened, true);
  assert.equal(output.effectiveDateRange.endDate, inDays(6));

  // The same day asked for explicitly is a hard bound.
  const explicit = await search.execute({
    query: "jazz",
    datePreset: "today",
  });
  assert.equal(explicit.effectiveDateRange.widened, false);
  assert.ok(!ids(explicit).includes("jazz-later"));
});

test("a query's today stays today when today has a match", async () => {
  const search = loadSearch([
    event({ id: "jazz-today", title: "Jazz Brunch", date: inDays(0) }),
    event({ id: "jazz-later", title: "Jazz Concert", date: inDays(2) }),
  ]);

  const output = await search.execute({ query: "jazz today" });
  assert.deepEqual(ids(output), ["jazz-today"]);
  assert.equal(output.effectiveDateRange.widened, false);
});

test("search names the filter its empty-result fallback dropped", async () => {
  const search = loadSearch([
    event({
      id: "lecture",
      title: "History Lecture",
      date: inDays(2),
      tags: ["Academic"],
    }),
  ]);

  const output = await search.execute({ query: "arts lecture" });
  assert.deepEqual(ids(output), ["lecture"]);
  assert.equal(output.fallbackUsed, true);
  assert.deepEqual(output.relaxed, { filter: "category", value: "Arts" });
  assert.match(output.fallbackMessage, /Showing all categories/);
  assert.ok(
    output.interpretations.some((chip) => chip.key === "category:Arts"),
  );
});

test("search reports a dropped topic as relaxed", async () => {
  const search = loadSearch(
    [event({ id: "workshop", title: "Writing Workshop", date: inDays(2) })],
    {
      topic_vocabulary: {
        version: 1,
        topics: [
          { slug: "law", label: "Law", group: "fields", synonyms: ["law"] },
        ],
      },
    },
  );

  const output = await search.execute({ query: "law workshop" });
  assert.deepEqual(ids(output), ["workshop"]);
  assert.deepEqual(output.relaxed, { filter: "topic", value: "law" });
});

test("dismiss drops an inferred chip the way the UI's x does", async () => {
  const search = loadSearch([
    event({
      id: "lecture",
      title: "History Lecture",
      date: inDays(2),
      tags: ["Academic"],
    }),
    event({ id: "today", title: "Jazz Concert", date: inDays(0) }),
    event({ id: "tomorrow", title: "Choir Concert", date: inDays(1) }),
  ]);

  const category = await search.execute({
    query: "arts lecture",
    dismiss: ["category:Arts"],
  });
  assert.equal(category.relaxed, null);
  assert.equal(category.fallbackUsed, false);
  assert.ok(
    !category.interpretations.some((chip) => chip.key === "category:Arts"),
  );

  const date = await search.execute({
    query: "concerts tomorrow",
    dismiss: ["dateRange:tomorrow"],
  });
  assert.deepEqual(new Set(ids(date)), new Set(["today", "tomorrow"]));
  assert.equal(date.effectiveDateRange.basis, "default");
  assert.deepEqual(date.interpretations, []);

  const bad = await search.execute({ query: "jazz", dismiss: "topic:law" });
  assert.match(bad.error, /dismiss must be an array/);
});

test("offset pages through total results", async () => {
  const search = loadSearch(
    [1, 2, 3, 4, 5].map((day) =>
      event({ id: `day-${day}`, title: `Event ${day}`, date: inDays(day) }),
    ),
  );

  const page = await search.execute({ limit: 2, offset: 2 });
  assert.equal(page.total, 5);
  assert.equal(page.count, 2);
  assert.equal(page.offset, 2);
  assert.deepEqual(ids(page), ["day-3", "day-4"]);

  const last = await search.execute({ limit: 2, offset: 4 });
  assert.deepEqual(ids(last), ["day-5"]);
  assert.equal(last.total, 5);
});

test("unknown or retired sources and unknown categories are errors", async () => {
  const search = loadSearch([event({ id: "a", date: inDays(1) })]);

  const unknown = await search.execute({ source: "nowhere" });
  assert.match(unknown.error, /Unknown source "nowhere"/);
  assert.match(unknown.error, /livewhale/);
  assert.equal(unknown.count, 0);

  const retired = await search.execute({ source: "callink" });
  assert.match(retired.error, /retired/);
  assert.doesNotMatch(retired.error, /Use one of:.*callink/);

  const badCategory = await search.execute({ category: "Cooking" });
  assert.match(badCategory.error, /Unknown category "Cooking"/);

  const okCategory = await search.execute({ category: "arts" });
  assert.equal(okCategory.error, undefined);
  assert.deepEqual(ids(okCategory), ["a"]);
});

test("the search schema offers active sources and real categories only", () => {
  const search = loadSearch([]);
  const { category, source } = search.inputSchema.properties;

  assert.deepEqual(
    category.enum,
    Categories.filter((item) => item !== "All"),
  );
  assert.deepEqual(source.enum, [...ACTIVE_SOURCES]);
  assert.ok(!source.enum.includes("callink"));
  assert.doesNotMatch(source.description, /callink/);
  for (const name of SourceNameSchema.options) {
    assert.equal(
      source.enum.includes(name),
      !SCHEMA_RETIRED_SOURCES.has(name),
      `${name} is offered only while active`,
    );
  }
});

test("appConfig and the pipeline schema agree on retired sources", () => {
  assert.deepEqual(
    [...RETIRED_SOURCES].sort(),
    [...SCHEMA_RETIRED_SOURCES].sort(),
  );
});
