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

test("WebMCP get_event_by_id returns the matching event or null", async () => {
  const tools = loadTools(
    makePayload([
      event({ id: "alpha", title: "Alpha Talk" }),
      event({ id: "beta", title: "Beta Talk" }),
    ]),
  );

  const getById = tools.get("get_event_by_id");
  assert.ok(getById, "get_event_by_id should register");

  const found = await getById.execute({ id: "beta" });
  assert.equal(found.event?.id, "beta");
  assert.equal(found.event?.title, "Beta Talk");

  const missing = await getById.execute({ id: "nope" });
  assert.equal(missing.event, null);

  const noId = await getById.execute({});
  assert.equal(noId.event, null);
  assert.match(noId.error, /id is required/);
});

test("WebMCP generate_event_ics escapes text and rolls a late-evening DTEND", async () => {
  const tools = loadTools(
    makePayload([
      event({
        id: "late",
        title: "Jazz; Blues, Night",
        date: "2026-05-30",
        time: "11:00 PM",
        description: "Line one\nLine two",
      }),
    ]),
  );

  const icsTool = tools.get("generate_event_ics");
  assert.ok(icsTool, "generate_event_ics should register");

  const result = await icsTool.execute({ id: "late" });
  assert.match(result.ics, /BEGIN:VCALENDAR/);
  assert.match(result.ics, /SUMMARY:Jazz\\; Blues\\, Night/);
  assert.match(result.ics, /DESCRIPTION:Line one\\nLine two/);
  assert.match(result.ics, /DTSTART;TZID=America\/Los_Angeles:20260530T230000/);
  assert.match(result.ics, /DTEND;TZID=America\/Los_Angeles:20260531T000000/);
  assert.doesNotMatch(result.ics, /T24\d{4}/);
  assert.equal(result.filename, "event-late.ics");

  const missing = await icsTool.execute({ id: "ghost" });
  assert.equal(missing.ics, null);
  assert.match(missing.error, /no event found/);
});

test("WebMCP datePreset 'today' resolves Pacific bounds to today's events", async () => {
  const todayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [y, m, d] = todayKey.split("-").map(Number);
  const tomorrow = new Date(Date.UTC(y, m - 1, d));
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowKey = tomorrow.toISOString().slice(0, 10);

  const tools = loadTools(
    makePayload([
      event({ id: "today-evt", title: "Today AI", date: todayKey }),
      event({ id: "tomorrow-evt", title: "Tomorrow AI", date: tomorrowKey }),
    ]),
  );

  const searchTool = tools.get("search_berkeley_events");
  const output = await searchTool.execute({ datePreset: "today" });
  assert.deepEqual(
    output.events.map((item) => item.id),
    ["today-evt"],
  );
});
