import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const webMcpPath = path.join(rootDir, "public", "webmcp-tools.js");

function makePayload(events) {
  return {
    lastUpdated: Date.parse("2026-05-13T12:00:00Z"),
    events,
  };
}

function event(overrides = {}) {
  return {
    id: overrides.id ?? "event",
    title: overrides.title ?? "AI Event",
    organizer: "UC Berkeley",
    date: overrides.date ?? "2026-05-13",
    time: overrides.time ?? "12:00 PM",
    location: "Campus",
    description: overrides.description ?? "AI event",
    tags: ["Science & Tech"],
    url: "https://example.com",
    source: "livewhale",
  };
}

function loadTools(payload) {
  const tools = new Map();
  const context = {
    AbortController,
    clearTimeout,
    console,
    fetch: async (requestPath) => {
      assert.equal(requestPath, "/events.json");
      return {
        ok: true,
        json: async () => payload,
      };
    },
    navigator: {
      modelContext: {
        registerTool: (tool) => tools.set(tool.name, tool),
      },
    },
    setTimeout,
    window: {
      location: { hostname: "localhost" },
    },
  };

  vm.createContext(context);
  vm.runInContext(fs.readFileSync(webMcpPath, "utf8"), context, {
    filename: webMcpPath,
  });
  return tools;
}

test("WebMCP event search sorts matches chronologically before applying limit", async () => {
  const tools = loadTools(
    makePayload([
      event({
        id: "june",
        title: "June AI Workshop",
        date: "2026-06-01",
      }),
      event({
        id: "may",
        title: "May AI Talk",
        date: "2026-05-14",
      }),
      event({
        id: "october",
        title: "October AI Forum",
        date: "2026-10-05",
      }),
      event({
        id: "later-june",
        title: "Later June AI Seminar",
        date: "2026-06-08",
      }),
    ]),
  );

  const searchTool = tools.get("search_berkeley_events");
  assert.ok(searchTool, "search tool should register");

  const output = await searchTool.execute({ query: "AI", limit: 3 });
  assert.deepEqual(
    output.events.map((item) => item.id),
    ["may", "june", "later-june"],
  );
});
