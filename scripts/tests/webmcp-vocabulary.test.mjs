import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createWebMcpTools } from "../../agent/webmcpTools.ts";
import { SOURCE_LABELS } from "../../appConfig.ts";
import {
  addDaysToDateKey,
  getCurrentPacificDateKey,
} from "../../utils/eventDates.ts";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function event(id) {
  return {
    id,
    title: `Event ${id}`,
    organizer: "UC Berkeley",
    date: addDaysToDateKey(getCurrentPacificDateKey(), 1),
    time: "12:00 PM",
    location: "Sather Gate",
    description: "Talk",
    tags: ["Academic"],
    topics: [],
    url: "https://example.com",
    source: "livewhale",
  };
}

const PAYLOAD = {
  lastUpdated: Date.parse("2026-10-30T12:00:00Z"),
  events: [event("known"), event("other")],
  topic_vocabulary: {
    version: 1,
    topics: [
      { slug: "law", label: "Law", group: "fields", synonyms: ["law"] },
      {
        slug: "film-media",
        label: "Film and Media",
        group: "interests",
        synonyms: ["film"],
      },
    ],
  },
};

function loadTools(locationSearch = "") {
  let currentSearch = locationSearch;
  const applied = [];
  const fetchedPaths = [];
  const toolList = createWebMcpTools({
    fetchJson: async (requestPath) => {
      fetchedPaths.push(requestPath);
      if (requestPath === "/events.json") return PAYLOAD;
      if (requestPath === "/search-index.json") return null;
      if (requestPath === "/status.json") return {};
      throw new Error(`unexpected path ${requestPath}`);
    },
    getLocationSearch: () => currentSearch,
    getOrigin: () => "https://cal-events.com",
    applyUrlSearch: (search) => {
      currentSearch = search;
      applied.push(search);
    },
  });
  const tools = new Map(toolList.map((tool) => [tool.name, tool]));
  return { tools, toolList, applied, fetchedPaths };
}

test("list_filter_options returns the accepted filter values", async () => {
  const { tools } = loadTools();
  const tool = tools.get("list_filter_options");
  assert.ok(tool, "list_filter_options should register");
  assert.equal(tool.annotations?.readOnlyHint, true);

  const options = await tool.execute();
  assert.deepEqual(options.categories, [
    "Academic",
    "Arts",
    "Sports",
    "Science & Tech",
    "Student Life",
    "Entrepreneurship",
  ]);
  const sourceIds = options.sources.map((source) => source.id);
  assert.ok(sourceIds.includes("livewhale"));
  assert.ok(!sourceIds.includes("callink"), "retired source is not offered");
  assert.ok(!sourceIds.includes("All"));
  for (const source of options.sources) {
    assert.equal(source.label, SOURCE_LABELS[source.id]);
  }
  assert.deepEqual(
    options.datePresets.map((preset) => preset.value),
    ["today", "tomorrow", "week", "upcoming"],
  );
  assert.equal(options.defaultDatePreset, "week");
  assert.deepEqual(options.topics, [
    { slug: "law", label: "Law", group: "fields" },
    { slug: "film-media", label: "Film and Media", group: "interests" },
  ]);
});

test("an unknown topic error lists the valid slugs", async () => {
  const { tools } = loadTools();
  for (const name of [
    "search_berkeley_events",
    "build_calevents_url",
    "apply_ui_state",
  ]) {
    const result = await tools.get(name).execute({ topic: "nope" });
    assert.match(result.error, /Unknown topic "nope"/, name);
    assert.match(result.error, /Use one of: law, film-media\./, name);
  }
});

test("build_calevents_url rejects unknown category, source and date", async () => {
  const { tools } = loadTools();
  const build = tools.get("build_calevents_url");

  const category = await build.execute({ category: "Music" });
  assert.match(category.error, /Unknown category "Music"/);
  assert.match(category.error, /Science & Tech/);
  assert.equal(category.url, undefined);

  const source = await build.execute({ source: "eventbrite" });
  assert.match(source.error, /Unknown source "eventbrite"/);
  assert.match(source.error, /livewhale/);

  const retired = await build.execute({ source: "callink" });
  assert.match(retired.error, /"callink" is retired and has no events/);
  assert.doesNotMatch(retired.error, /Use one of: [^.]*callink/);

  const date = await build.execute({ date: "weekend" });
  assert.match(date.error, /Unknown date "weekend"/);

  const ok = await build.execute({ category: "arts", source: "All" });
  assert.equal(ok.error, undefined);
  assert.equal(ok.filters.category, "Arts");
  assert.equal(ok.search, "?category=Arts");
});

test("search and the URL tools share one case rule and error format", async () => {
  const { tools } = loadTools();
  const names = [
    "search_berkeley_events",
    "build_calevents_url",
    "apply_ui_state",
  ];
  const messages = (results) => results.map((result) => result.error);

  for (const name of names) {
    const tool = tools.get(name);
    const cleared = await tool.execute({ category: "all", source: "ALL" });
    assert.equal(cleared.error, undefined, name);
    const mixedCase = await tool.execute({
      category: "science & tech",
      source: "LiveWhale",
    });
    assert.equal(mixedCase.error, undefined, name);
  }

  const run = (input) =>
    Promise.all(
      names.map((name) =>
        tools.get(name).execute({ ...input, datePreset: input.date }),
      ),
    );
  for (const input of [
    { category: "Music" },
    { source: "eventbrite" },
    { source: "callink" },
    { date: "weekend" },
  ]) {
    const errors = messages(await run(input));
    assert.equal(new Set(errors).size, 1, JSON.stringify(errors));
    assert.match(errors[0], /Use one of: /);
  }
  const [retired] = messages(await run({ source: "callink" }));
  assert.equal(
    retired.split("Use one of:")[0],
    'Source "callink" is retired and has no events. ',
  );
});

test("apply_ui_state refuses unknown values without changing the page", async () => {
  const { tools, applied } = loadTools("?q=jazz");
  const apply = tools.get("apply_ui_state");

  for (const input of [
    { category: "Music" },
    { source: "callink" },
    { event: "missing-id" },
    { mode: "append" },
  ]) {
    const result = await apply.execute(input);
    assert.equal(result.applied, false, JSON.stringify(input));
    assert.ok(result.error, JSON.stringify(input));
  }
  assert.equal(applied.length, 0);

  const missing = await apply.execute({ event: "missing-id" });
  assert.match(missing.error, /No event found for id missing-id/);

  const known = await apply.execute({ event: "known" });
  assert.equal(known.applied, true);
  assert.deepEqual(applied, ["?event=known"]);
});

test("apply_ui_state replace mode resets fields that are left out", async () => {
  const { tools, applied } = loadTools(
    "?q=jazz&date=today&category=Arts&event=known",
  );
  const result = await tools.get("apply_ui_state").execute({ source: "haas" });
  assert.equal(result.applied, true);
  assert.equal(result.mode, "replace");
  assert.deepEqual(applied, ["?source=haas"]);
});

test("apply_ui_state merge mode keeps the current URL state", async () => {
  const { tools, applied, fetchedPaths } = loadTools(
    "?q=jazz&date=today&category=Arts&event=known",
  );
  const apply = tools.get("apply_ui_state");

  const merged = await apply.execute({ mode: "merge", source: "haas" });
  assert.equal(merged.applied, true);
  assert.equal(merged.mode, "merge");
  assert.equal(merged.selectedEventId, "known");
  assert.equal(
    applied.at(-1),
    "?q=jazz&date=today&category=Arts&source=haas&event=known",
  );
  // The kept event is already on the page, so the feed is not fetched.
  assert.equal(fetchedPaths.includes("/events.json"), false);

  const cleared = await apply.execute({
    mode: "merge",
    category: "All",
    q: "",
  });
  assert.equal(applied.at(-1), "?date=today&source=haas&event=known");
  assert.equal(cleared.filters.category, "All");

  const closed = await apply.execute({ mode: "merge", event: null });
  assert.equal(closed.selectedEventId, null);
  assert.equal(applied.at(-1), "?date=today&source=haas");
});

test("an agent-chosen date stays in the URL even when it is the default", async () => {
  const { tools, applied } = loadTools("?q=jazz+tonight&date=week");
  const apply = tools.get("apply_ui_state");

  await apply.execute({ q: "jazz tonight", date: "week" });
  assert.equal(applied.at(-1), "?q=jazz+tonight&date=week");

  // Merge keeps a date the user already pinned.
  await apply.execute({ mode: "merge", category: "Arts" });
  assert.equal(applied.at(-1), "?q=jazz+tonight&date=week&category=Arts");

  // With no date given, the default stays out of the URL.
  await apply.execute({ q: "jazz" });
  assert.equal(applied.at(-1), "?q=jazz");

  const built = await tools
    .get("build_calevents_url")
    .execute({ q: "jazz", datePreset: "week" });
  assert.equal(built.search, "?q=jazz&date=week");
});

test("apply_ui_state merge keeps a topic from the current URL", async () => {
  const { tools, applied } = loadTools("?topic=law&q=moot");
  const result = await tools
    .get("apply_ui_state")
    .execute({ mode: "merge", date: "upcoming" });
  assert.equal(result.applied, true);
  assert.equal(applied.at(-1), "?q=moot&date=upcoming&topic=law");
});

test("apply_ui_state reset returns to the default view", async () => {
  const { tools, applied } = loadTools(
    "?q=jazz&date=today&category=Arts&event=known",
  );
  const apply = tools.get("apply_ui_state");

  const reset = await apply.execute({ mode: "merge", reset: true });
  assert.equal(reset.applied, true);
  assert.equal(reset.reset, true);
  assert.equal(reset.selectedEventId, null);
  assert.equal(applied.at(-1), "");

  await apply.execute({ reset: true, q: "film" });
  assert.equal(applied.at(-1), "?q=film");
});

test("every WebMCP tool is named in the agent docs", () => {
  const { toolList } = loadTools();
  const docs = {
    "public/llms.txt": readText("public/llms.txt"),
    "public/for-agents.html": readText("public/for-agents.html"),
    "public/.well-known/mcp/server-card.json": readText(
      "public/.well-known/mcp/server-card.json",
    ),
  };
  for (const tool of toolList) {
    for (const [file, text] of Object.entries(docs)) {
      assert.ok(text.includes(tool.name), `${file} must list ${tool.name}`);
    }
  }
  assert.match(readText("public/llms-full.txt"), /`list_filter_options`/);
});
