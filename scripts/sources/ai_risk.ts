/**
 * Berkeley AI Risk speaker series adapter.
 *
 * ai-risk.berkeley.edu is a static site built from its data/talks.json. The
 * build publishes events.json for the series' Google Calendar sync: one entry
 * per talk with a slug, start and end times with offsets, a location, and a
 * description. We read that feed. The site retired speaker-series.js in
 * September 2026, and speaker-series.html now redirects to /#upcoming.
 *
 * Feed titles read "AI Risk speaker series: <speaker>". The talk title is the
 * first line of the description's first paragraph, above the speaker line.
 * While a title is TBA, that paragraph holds only the speaker line.
 *
 * None of these talks appear in the central LiveWhale feed.
 */

import { z } from "zod";

import type { CanonicalEvent, FetchResult, Modality } from "../lib/schema.js";
import { CanonicalEventSchema } from "../lib/schema.js";
import { endedBeforePT, todayPT } from "../lib/normalize.js";
import type { FetchOptions } from "../lib/abort.js";
import { fetchWithRetry } from "../lib/fetchWithRetry.js";

export const SITE_URL = "https://ai-risk.berkeley.edu/";
export const FEED_URL = "https://ai-risk.berkeley.edu/events.json";
const FETCH_TIMEOUT_MS = 15_000;
const PT_TIME_ZONE = "America/Los_Angeles";
const SERIES_NAME = "Berkeley AI Risk Speaker Series";
const FEED_TITLE_PREFIX = /^AI Risk speaker series:\s*/i;
const UNANNOUNCED_TITLE = /^(tba|tbd|title to be announced)\.?$/i;

const FeedEventSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string(),
  start: z.string(),
  end: z.string(),
  location: z.string().default(""),
  description: z.string().default(""),
});

export type AiRiskFeedEvent = z.infer<typeof FeedEventSchema>;

/** The feed's `events` array. Throws when the feed has changed shape. */
export function feedEntries(body: unknown): unknown[] {
  const events =
    body && typeof body === "object"
      ? (body as { events?: unknown }).events
      : undefined;
  if (!Array.isArray(events)) {
    throw new Error("AI Risk events.json has no events array");
  }
  return events;
}

function inferModality(location: string, zoomUrl: string): Modality {
  const haystack = `${location} ${zoomUrl}`.toLowerCase();
  const virtual = /\b(zoom|virtual|online|webinar)\b/.test(haystack);
  const inPerson =
    /\b(hall|room|plaza|auditorium|lab|building|soda|sutardja)\b/.test(
      haystack,
    );
  if (virtual && inPerson) return "hybrid";
  if (virtual) return "virtual";
  return "in_person";
}

export function mapFeedEvent(
  item: AiRiskFeedEvent,
  fetchedAt: string,
): CanonicalEvent | null {
  if (Number.isNaN(Date.parse(item.start))) return null;

  const talkUrl = `${SITE_URL}#${item.slug}`;
  const [heading = "", ...rest] = item.description
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const headingLines = heading
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const speaker = item.title.replace(FEED_TITLE_PREFIX, "").trim();

  // "Title\nSpeaker (Affiliation)", or the speaker line alone while TBA.
  const talkTitle = headingLines.length > 1 ? headingLines[0] : "";
  const speakerLine =
    headingLines.length > 1
      ? headingLines.slice(1).join(" ")
      : (headingLines[0] ?? speaker);
  const title =
    talkTitle && !UNANNOUNCED_TITLE.test(talkTitle)
      ? talkTitle
      : speaker
        ? `${speaker} — ${SERIES_NAME}`
        : SERIES_NAME;

  // Keep the abstract. The Zoom line and the talk link are feed metadata.
  let zoomUrl = "";
  const abstract = rest
    .filter((paragraph) => {
      const zoom = paragraph.match(/^Zoom:\s*(\S+)$/i);
      if (zoom) {
        zoomUrl = zoom[1];
        return false;
      }
      return paragraph !== talkUrl;
    })
    .join("\n\n");

  const location = item.location.trim();
  const candidate: CanonicalEvent = {
    source_name: "ai_risk",
    source_id: item.slug,
    source_url: SITE_URL,
    evidence_url: FEED_URL,
    title,
    description: [speakerLine, abstract].filter(Boolean).join("\n\n") || title,
    start_at: item.start,
    end_at: item.end || undefined,
    timezone: PT_TIME_ZONE,
    all_day: false,
    venue: location || "UC Berkeley",
    building: "",
    address: "",
    modality: inferModality(location, zoomUrl),
    organizer: "Berkeley AI Risk",
    organizer_unit: "Berkeley AI Risk",
    audience: "",
    cost: "",
    canonical_url: talkUrl,
    categories: ["Science & Tech"],
    tags: ["Science & Tech"],
    last_seen_at: fetchedAt,
    confidence: 0.9,
    quality_flags: [],
  };

  const validated = CanonicalEventSchema.safeParse(candidate);
  return validated.success ? validated.data : null;
}

export async function fetchAiRisk(
  options: FetchOptions = {},
): Promise<FetchResult> {
  const todayIso = todayPT();
  const fetched_at = new Date().toISOString();

  const res = await fetchWithRetry(
    FEED_URL,
    {
      headers: {
        "User-Agent": "Cal-Events-Discovery-Bot",
        Accept: "application/json",
      },
    },
    {
      signal: options.signal,
      timeoutMs: FETCH_TIMEOUT_MS,
      label: "ai_risk",
    },
  );

  const entries = feedEntries(await res.json());
  const events: CanonicalEvent[] = [];
  let filteredPast = 0;
  let invalid = 0;

  for (const entry of entries) {
    const parsed = FeedEventSchema.safeParse(entry);
    const mapped = parsed.success
      ? mapFeedEvent(parsed.data, fetched_at)
      : null;
    if (!mapped) {
      invalid++;
      continue;
    }
    if (endedBeforePT(mapped, todayIso)) {
      filteredPast++;
      continue;
    }
    events.push(mapped);
  }

  console.log(
    `[ai_risk] parsed ${events.length}/${entries.length} (past: ${filteredPast}, invalid: ${invalid})`,
  );
  return { events, rawCount: entries.length, filteredPast, invalid };
}
