import assert from "node:assert/strict";
import test from "node:test";

import { createWebMcpTools } from "../../agent/webmcpTools.ts";

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
    location: overrides.location ?? "Sather Gate",
    description: overrides.description ?? "AI event",
    tags: overrides.tags ?? ["Science & Tech"],
    url: "https://example.com",
    source: overrides.source ?? "livewhale",
  };
}

function loadTools(payload, options = {}) {
  const tools = new Map();
  let locationSearch = options.locationSearch ?? "";
  const applied = [];

  const toolList = createWebMcpTools({
    fetchJson: async (requestPath) => {
      if (requestPath === "/events.json") {
        return payload;
      }
      if (requestPath === "/search-index.json") {
        return options.searchIndex ?? null;
      }
      if (requestPath === "/status.json") {
        return options.status ?? { total_events: payload.events.length };
      }
      throw new Error(`unexpected path ${requestPath}`);
    },
    getLocationSearch: () => locationSearch,
    getOrigin: () => "https://cal-events.com",
    applyUrlSearch: (search) => {
      locationSearch = search;
      applied.push(search);
    },
  });

  for (const tool of toolList) {
    tools.set(tool.name, tool);
  }

  return { tools, applied, getSearch: () => locationSearch };
}

test("WebMCP ranked search returns AI matches with ranked flag", async () => {
  const { tools } = loadTools(
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
      event({
        id: "unrelated",
        title: "Pottery Night",
        date: "2026-05-20",
        description: "Clay workshop",
      }),
    ]),
  );

  const searchTool = tools.get("search_berkeley_events");
  assert.ok(searchTool, "search tool should register");

  const output = await searchTool.execute({ query: "AI", limit: 10 });
  assert.equal(output.ranked, true);
  assert.equal(output.count, 4);
  assert.deepEqual(
    new Set(output.events.map((item) => item.id)),
    new Set(["may", "june", "later-june", "october"]),
  );
  assert.ok(output.events.every((item) => "directionsUrl" in item));
});

test("WebMCP get_event_by_id returns directions and calendar links", async () => {
  const { tools } = loadTools(
    makePayload([
      event({ id: "alpha", title: "Alpha Talk" }),
      event({ id: "beta", title: "Beta Talk", location: "Doe Library" }),
    ]),
  );

  const getById = tools.get("get_event_by_id");
  assert.ok(getById, "get_event_by_id should register");

  const found = await getById.execute({ id: "beta" });
  assert.equal(found.event?.id, "beta");
  assert.equal(found.event?.title, "Beta Talk");
  assert.match(found.event.directionsUrl, /google\.com\/maps/);
  assert.match(found.event.googleCalendarUrl, /calendar\.google\.com/);
  assert.match(found.event.permalink, /event=beta/);

  const missing = await getById.execute({ id: "nope" });
  assert.equal(missing.event, null);

  const noId = await getById.execute({});
  assert.equal(noId.event, null);
  assert.match(noId.error, /id is required/);
});

test("WebMCP generate_event_ics escapes text and rolls a late-evening DTEND", async () => {
  const { tools } = loadTools(
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
  assert.ok(result.googleCalendarUrl);

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

  const { tools } = loadTools(
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
  assert.equal(output.ranked, false);
});

test("WebMCP URL workspace tools build and apply shared state", async () => {
  const { tools, applied } = loadTools(makePayload([]), {
    locationSearch: "?q=jazz&date=today",
  });

  const getUi = tools.get("get_ui_state");
  const buildUrl = tools.get("build_calevents_url");
  const applyUi = tools.get("apply_ui_state");

  const state = await getUi.execute({ includeFeedStatus: true });
  assert.equal(state.filters.searchQuery, "jazz");
  assert.equal(state.filters.dateRange, "today");
  assert.equal(state.feedStatus.total_events, 0);

  const built = await buildUrl.execute({
    q: "moffitt",
    date: "week",
    category: "Academic",
    event: "abc",
  });
  assert.match(built.url, /cal-events\.com\/\?/);
  assert.match(built.search, /q=moffitt/);
  assert.match(built.search, /event=abc/);
  assert.match(built.search, /category=Academic/);

  const appliedResult = await applyUi.execute({
    query: "haas",
    datePreset: "tomorrow",
    source: "haas",
  });
  assert.equal(appliedResult.applied, true);
  assert.equal(applied.length, 1);
  assert.match(applied[0], /q=haas/);
  assert.match(applied[0], /date=tomorrow/);
  assert.match(applied[0], /source=haas/);
});

test("WebMCP get_event_directions returns maps URL", async () => {
  const { tools } = loadTools(
    makePayload([event({ id: "lib", location: "Moffitt Library" })]),
  );

  const directions = tools.get("get_event_directions");
  const byId = await directions.execute({ id: "lib" });
  assert.match(byId.directionsUrl, /Moffitt/);

  const byLocation = await directions.execute({ location: "Sproul Plaza" });
  assert.match(byLocation.directionsUrl, /Sproul/);
});
