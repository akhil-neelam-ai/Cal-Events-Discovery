import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildDefaultPreview,
  buildEventPreview,
  describeWhen,
  findPublishedEvent,
  renderPreviewHtml,
} from "../../api/_lib/eventPreview.ts";
import * as previewHandler from "../../api/event-preview.ts";
import * as imageHandler from "../../api/event-image.tsx";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const ORIGIN = "https://cal-events.com";
const NOW = new Date("2026-10-24T19:00:00Z");

const publishedEvents = JSON.parse(
  fs.readFileSync(path.join(rootDir, "public", "events.json"), "utf8"),
).events;

function makeEvent(overrides = {}) {
  return {
    id: "haas_1@example",
    title: "Climate Alumni Night",
    organizer: "Berkeley Haas",
    date: "2026-10-29",
    time: "5:00 PM",
    end_time: "8:00 PM",
    location: "9Zero Climate Innovation Hub, San Francisco",
    description: "**Rescheduled.**  Designers   and alumni meet.",
    tags: ["Entrepreneurship"],
    topics: [],
    url: "https://haas.berkeley.edu/event/1",
    source: "haas",
    ...overrides,
  };
}

test("describeWhen covers single-day, all-day, and running spans", () => {
  assert.equal(
    describeWhen(makeEvent(), NOW),
    "Thu, Oct 29 · 5:00 PM – 8:00 PM",
  );
  assert.equal(
    describeWhen(makeEvent({ end_time: undefined }), NOW),
    "Thu, Oct 29 · 5:00 PM",
  );
  assert.equal(
    describeWhen(makeEvent({ date: "2027-01-02", end_time: undefined }), NOW),
    "Sat, Jan 2, 2027 · 5:00 PM",
  );
  assert.equal(
    describeWhen(makeEvent({ time: "All day", end_time: undefined }), NOW),
    "Thu, Oct 29 · All day",
  );
  assert.equal(
    describeWhen(
      makeEvent({
        date: "2026-10-24",
        time: "All day",
        end_time: undefined,
        end_date: "2026-10-27",
        dates: ["2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"],
      }),
      NOW,
    ),
    "Through Oct 27",
  );
});

test("event preview links the clean event URL and its card image", () => {
  const preview = buildEventPreview(makeEvent(), ORIGIN, NOW);

  assert.equal(preview.title, "Climate Alumni Night");
  assert.equal(preview.pageUrl, `${ORIGIN}/?event=haas_1%40example`);
  assert.equal(
    preview.imageUrl,
    `${ORIGIN}/api/event-image?event=haas_1%40example`,
  );
  assert.equal(
    preview.description,
    "Thu, Oct 29 · 5:00 PM – 8:00 PM · 9Zero Climate Innovation Hub, San Francisco. Rescheduled. Designers and alumni meet.",
  );
  assert.ok(preview.indexable);
});

test("a shortened location is not followed by a stray period", () => {
  const preview = buildEventPreview(
    makeEvent({
      location:
        "9Zero Climate Innovation Hub, 350 California St 4th floor, San Francisco, CA 94104, USA",
    }),
    ORIGIN,
    NOW,
  );

  assert.equal(
    preview.description,
    "Thu, Oct 29 · 5:00 PM – 8:00 PM · 9Zero Climate Innovation Hub, 350 California St 4th floor… Rescheduled. Designers and alumni meet.",
  );
});

test("a description that only repeats the title is left out", () => {
  const preview = buildEventPreview(
    makeEvent({ description: "  climate alumni   NIGHT " }),
    ORIGIN,
    NOW,
  );

  assert.equal(
    preview.description,
    "Thu, Oct 29 · 5:00 PM – 8:00 PM · 9Zero Climate Innovation Hub, San Francisco",
  );
});

test("preview HTML escapes event text inside tags and attributes", () => {
  const html = renderPreviewHtml(
    buildEventPreview(
      makeEvent({ title: `"Hack" <night> & 'fun'` }),
      ORIGIN,
      NOW,
    ),
  );

  assert.match(
    html,
    /<meta property="og:title" content="&quot;Hack&quot; &lt;night&gt; &amp; &#39;fun&#39;" \/>/,
  );
  assert.doesNotMatch(html, /<night>/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image"/);
  assert.match(html, /<meta property="og:image:width" content="1200"/);
});

test("the site-wide fallback preview is not indexed", () => {
  const html = renderPreviewHtml(buildDefaultPreview(ORIGIN));

  assert.match(html, /<meta name="robots" content="noindex" \/>/);
  assert.match(html, /content="https:\/\/cal-events\.com\/og-image\.png"/);
  assert.match(html, /This event is no longer listed\./);
});

test("findPublishedEvent reads the committed feed", async () => {
  const sample = publishedEvents[0];

  assert.equal((await findPublishedEvent(sample.id))?.title, sample.title);
  assert.equal(await findPublishedEvent("missing_event_id"), undefined);
  assert.equal(await findPublishedEvent(""), undefined);
});

test("preview handler answers with event tags, or the site-wide tags", async () => {
  const sample = publishedEvents.find((event) => event.location);
  const response = await previewHandler.GET(
    new Request(
      `${ORIGIN}/api/event-preview?q=talk&event=${encodeURIComponent(sample.id)}`,
    ),
  );
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("content-type"),
    "text/html; charset=utf-8",
  );
  assert.ok(html.includes(`/?event=${encodeURIComponent(sample.id)}"`));
  assert.ok(!html.includes("q=talk"));
  assert.match(
    html,
    /og:image" content="https:\/\/cal-events\.com\/api\/event-image\?event=/,
  );

  const missing = await previewHandler.GET(
    new Request(`${ORIGIN}/api/event-preview?event=missing_event_id`),
  );
  assert.match(await missing.text(), /og-image\.png/);

  const head = await previewHandler.HEAD(
    new Request(`${ORIGIN}/api/event-preview?event=missing_event_id`),
  );
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
});

// Also guards the @vercel/og pin: 1.0.2 and 1.0.3 crash under plain Node ESM.
test("image handler renders a PNG card and redirects unknown events", async () => {
  const sample = publishedEvents.find((event) => event.location);
  const response = await imageHandler.GET(
    new Request(
      `${ORIGIN}/api/event-image?event=${encodeURIComponent(sample.id)}`,
    ),
  );
  const png = Buffer.from(await response.arrayBuffer());

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(
    response.headers.get("cache-control"),
    "public, max-age=3600, s-maxage=86400",
  );
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);

  const missing = await imageHandler.GET(
    new Request(`${ORIGIN}/api/event-image?event=missing_event_id`),
  );
  assert.equal(missing.status, 302);
  assert.equal(missing.headers.get("location"), `${ORIGIN}/og-image.png`);
});

const CRAWLER_AGENTS = [
  "WhatsApp/2.23.20.0 A",
  "WhatsApp/2", // Signal
  "facebookexternalhit/1.1 Facebot Twitterbot/1.0", // iMessage
  "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  "Twitterbot/1.0",
  "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
  "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
  "TelegramBot (like TwitterBot)",
  "LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)",
  "Mozilla/5.0 (Windows NT 6.1; WOW64) SkypeUriPreview Preview/0.5 skype-url-preview@microsoft.com",
  "Mozilla/5.0 (compatible; Google-PageRenderer Google (+https://developers.google.com/+/web/snippet/))",
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
];

const PERSON_AGENTS = [
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 WhatsApp/2.24.1",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0]",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0",
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 Telegram-Android/11.2",
];

test("vercel.json sends only link-preview crawlers to the preview page", () => {
  const vercel = JSON.parse(
    fs.readFileSync(path.join(rootDir, "vercel.json"), "utf8"),
  );
  const routeIndex = vercel.routes.findIndex(
    (entry) => entry.dest === "/api/event-preview",
  );
  const route = vercel.routes[routeIndex];
  const filesystemIndex = vercel.routes.findIndex(
    (entry) => entry.handle === "filesystem",
  );

  assert.ok(route, "the event preview route must exist");
  assert.equal(route.src, "^/$");
  assert.ok(routeIndex < filesystemIndex, "must run before the static app");
  assert.ok(
    route.has.some((entry) => entry.type === "query" && entry.key === "event"),
  );

  const userAgent = route.has.find(
    (entry) => entry.type === "header" && entry.key === "user-agent",
  );
  const crawler = new RegExp(userAgent.value);
  for (const agent of CRAWLER_AGENTS) {
    assert.match(agent, crawler);
  }
  for (const agent of PERSON_AGENTS) {
    assert.doesNotMatch(agent, crawler);
  }
});

test("vercel.json bundles the files the preview functions read", () => {
  const vercel = JSON.parse(
    fs.readFileSync(path.join(rootDir, "vercel.json"), "utf8"),
  );

  assert.match(
    vercel.functions["api/event-preview.ts"].includeFiles,
    /public\/events\.json/,
  );
  const imageIncludes = vercel.functions["api/event-image.tsx"].includeFiles;
  assert.match(imageIncludes, /public\/events\.json/);
  assert.match(imageIncludes, /api\/_fonts\/\*\.woff/);

  const imageSource = fs.readFileSync(
    path.join(rootDir, "api", "event-image.tsx"),
    "utf8",
  );
  for (const [, file] of imageSource.matchAll(/file: "([^"]+\.woff)"/g)) {
    assert.ok(
      fs.existsSync(path.join(rootDir, "api", "_fonts", file)),
      `${file} must exist`,
    );
  }
});
