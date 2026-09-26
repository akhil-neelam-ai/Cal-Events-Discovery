import assert from "node:assert/strict";
import test from "node:test";

import { addDaysToDateKey } from "../../utils/eventDates.ts";
import { todayPT } from "../../scripts/lib/normalize.ts";
import {
  FEED_URL,
  fetchAiRisk,
  mapFeedEvent,
} from "../../scripts/sources/ai_risk.ts";

const ZOOM = "https://berkeley.zoom.us/j/96396540012";

// Entries copy the shape that the site's tools/build.mjs writes.
const KRUEGER = {
  slug: "david-krueger",
  title: "AI Risk speaker series: David Krueger",
  start: "2025-09-09T16:30:00-07:00",
  end: "2025-09-09T18:00:00-07:00",
  location: "621 Sutardja Dai Hall",
  description: [
    "Everything You Always Wanted to Know About AI Safety (But Were Afraid to Ask)\nDavid Krueger (University of Montreal)",
    "A whirlwind tour of AI Safety.",
    "Second paragraph.",
    `Zoom: ${ZOOM}`,
    "https://ai-risk.berkeley.edu/#david-krueger",
  ].join("\n\n"),
};

const PIERSON = {
  slug: "emma-pierson",
  title: "AI Risk speaker series: Emma Pierson",
  start: "2026-11-17T16:00:00-08:00",
  end: "2026-11-17T17:30:00-08:00",
  location: "621 Sutardja Dai Hall",
  description: [
    "Emma Pierson (UC Berkeley)",
    `Zoom: ${ZOOM}`,
    "https://ai-risk.berkeley.edu/#emma-pierson",
  ].join("\n\n"),
};

const NEWMAN = {
  slug: "jessica-newman",
  title: "AI Risk speaker series: Jessica Newman",
  start: "2025-11-18T16:30:00-08:00",
  end: "2025-11-18T18:00:00-08:00",
  location: "Zoom only",
  description:
    "Can we Manage the Risks of Frontier AI?\nJessica Newman (UC Berkeley)\n\nhttps://ai-risk.berkeley.edu/#jessica-newman",
};

const FETCHED_AT = "2026-09-26T00:00:00Z";

test("a titled talk takes its title from the first description line", () => {
  const event = mapFeedEvent(KRUEGER, FETCHED_AT);

  assert.ok(event);
  assert.equal(event.source_name, "ai_risk");
  assert.equal(event.source_id, "david-krueger");
  assert.equal(
    event.title,
    "Everything You Always Wanted to Know About AI Safety (But Were Afraid to Ask)",
  );
  assert.equal(
    event.description,
    "David Krueger (University of Montreal)\n\nA whirlwind tour of AI Safety.\n\nSecond paragraph.",
  );
  assert.equal(event.start_at, "2025-09-09T16:30:00-07:00");
  assert.equal(event.end_at, "2025-09-09T18:00:00-07:00");
  assert.equal(event.venue, "621 Sutardja Dai Hall");
  assert.equal(event.modality, "hybrid");
  assert.equal(
    event.canonical_url,
    "https://ai-risk.berkeley.edu/#david-krueger",
  );
  assert.equal(event.evidence_url, FEED_URL);
});

test("a TBA talk uses the speaker name as its title", () => {
  const event = mapFeedEvent(PIERSON, FETCHED_AT);

  assert.ok(event);
  assert.equal(event.title, "Emma Pierson — Berkeley AI Risk Speaker Series");
  assert.equal(event.description, "Emma Pierson (UC Berkeley)");
});

test("a Zoom-only talk is virtual", () => {
  const event = mapFeedEvent(NEWMAN, FETCHED_AT);

  assert.ok(event);
  assert.equal(event.title, "Can we Manage the Risks of Frontier AI?");
  assert.equal(event.modality, "virtual");
});

async function withFeed(body, run) {
  const originalFetch = globalThis.fetch;
  const fetchedUrls = [];
  globalThis.fetch = async (url) => {
    fetchedUrls.push(String(url));
    return { ok: true, status: 200, json: async () => body };
  };
  try {
    return { result: await run(), fetchedUrls };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("fetchAiRisk reads events.json and drops finished talks", async () => {
  const today = todayPT();
  const past = addDaysToDateKey(today, -30);
  const next = addDaysToDateKey(today, 20);
  const body = {
    calendar: "series@group.calendar.google.com",
    events: [
      {
        ...KRUEGER,
        start: `${past}T16:00:00-07:00`,
        end: `${past}T17:30:00-07:00`,
      },
      {
        ...PIERSON,
        start: `${next}T16:00:00-07:00`,
        end: `${next}T17:30:00-07:00`,
      },
      { title: "AI Risk speaker series: No Slug", start: "2026-10-01" },
    ],
  };

  const { result, fetchedUrls } = await withFeed(body, () => fetchAiRisk());

  assert.deepEqual(fetchedUrls, [FEED_URL]);
  assert.equal(result.rawCount, 3);
  assert.equal(result.filteredPast, 1);
  assert.equal(result.invalid, 1);
  assert.deepEqual(
    result.events.map((event) => event.source_id),
    ["emma-pierson"],
  );
});

test("a feed without an events array fails the fetch", async () => {
  await assert.rejects(
    withFeed({ calendar: "series" }, () => fetchAiRisk()),
    /no events array/,
  );
});
