/**
 * Link previews for shared event URLs (`/?event=<id>`). Chat apps read Open
 * Graph tags without running JavaScript, so they never see what the app
 * renders. vercel.json sends their crawlers to api/event-preview.ts, which
 * answers with event-specific tags and a card from api/event-image.tsx.
 *
 * Relative imports carry a .js extension because Vercel runs these functions
 * as plain Node ESM, which does not guess extensions.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { CalEvent } from "../../types";
import {
  formatMultiDayWhen,
  getPacificDateKey,
} from "../../utils/eventDates.js";
import {
  getCategoryStyle,
  shortenVenue,
} from "../../utils/eventPresentation.js";

const SITE_NAME = "CalEvents";
const DEFAULT_TITLE = "CalEvents - Discover UC Berkeley Campus Events";
const DEFAULT_DESCRIPTION =
  "Find lectures, performances, sports games, workshops, and more across all Berkeley campus schools. Updated daily.";

/** Bundled with each function through `includeFiles` in vercel.json. */
const EVENTS_PATH = path.join(process.cwd(), "public", "events.json");

export interface EventCard {
  title: string;
  when: string;
  location: string;
  organizer: string;
  category: string;
  /** Category strip color shared with the event cards in the app. */
  accent: string;
}

export interface LinkPreview {
  title: string;
  description: string;
  pageUrl: string;
  imageUrl: string;
  imageAlt: string;
  /** Plain-text lines for the page body, for crawlers that index text. */
  details: string[];
  indexable: boolean;
}

let eventsById: Promise<Map<string, CalEvent>> | null = null;

/** Look up a published event. The feed is parsed once per warm instance. */
export async function findPublishedEvent(
  id: string,
): Promise<CalEvent | undefined> {
  if (!id) return undefined;
  eventsById ??= readFile(EVENTS_PATH, "utf8")
    .then((text) => {
      const events = (JSON.parse(text) as { events: CalEvent[] }).events;
      return new Map(events.map((event) => [event.id, event]));
    })
    .catch((error: unknown) => {
      eventsById = null;
      throw error;
    });
  return (await eventsById).get(id);
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  const base = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${base.replace(/[\s,;:.–-]+$/, "")}…`;
}

function plainText(text: string): string {
  return text.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
}

function isAllDay(time: string | undefined): boolean {
  return !time || /all\s*day/i.test(time);
}

/** "Thu, Oct 29 · 5:00 PM – 7:00 PM", or "Through Feb 22" for a running span. */
export function describeWhen(event: CalEvent, now = new Date()): string {
  const allDay = isAllDay(event.time);
  const timeLabel = allDay
    ? "All day"
    : event.end_time
      ? `${event.time} – ${event.end_time}`
      : event.time;

  const span = formatMultiDayWhen(event, now);
  if (span) {
    return allDay ? span : `${span} · ${timeLabel}`;
  }

  const dateKey = getPacificDateKey(event.date) || event.date.slice(0, 10);
  const [year, month, day] = dateKey.split("-").map(Number);
  if (!year || !month || !day) {
    return timeLabel;
  }
  const dateLabel = new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(
    "en-US",
    { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" },
  );
  return `${dateLabel} · ${timeLabel}`;
}

export function buildEventCard(event: CalEvent, now = new Date()): EventCard {
  const style = getCategoryStyle(event.tags[0]);
  return {
    title: plainText(event.title),
    when: describeWhen(event, now),
    location: plainText(shortenVenue(event.location)),
    organizer: plainText(event.organizer),
    category: style.label,
    accent: style.stripColor,
  };
}

export function eventPageUrl(origin: string, id: string): string {
  return `${origin}/?event=${encodeURIComponent(id)}`;
}

export function buildEventPreview(
  event: CalEvent,
  origin: string,
  now = new Date(),
): LinkPreview {
  const card = buildEventCard(event, now);
  const logistics = card.location
    ? `${card.when} · ${truncate(card.location, 60)}`
    : card.when;
  const summary = truncate(plainText(event.description), 160);
  // A shortened location already ends in "…", so it takes no period.
  const lead = logistics.endsWith("…") ? logistics : `${logistics}.`;
  const description = truncate(summary ? `${lead} ${summary}` : logistics, 300);

  return {
    title: card.title,
    description,
    pageUrl: eventPageUrl(origin, event.id),
    imageUrl: `${origin}/api/event-image?event=${encodeURIComponent(event.id)}`,
    imageAlt: `${card.title}, ${card.when}`,
    details: [card.when, card.location, card.organizer].filter(Boolean),
    indexable: true,
  };
}

/** The site-wide preview, for an event that has ended or never existed. */
export function buildDefaultPreview(origin: string): LinkPreview {
  return {
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    pageUrl: `${origin}/`,
    imageUrl: `${origin}/og-image.png`,
    imageAlt: DEFAULT_TITLE,
    details: ["This event is no longer listed."],
    indexable: false,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderPreviewHtml(preview: LinkPreview): string {
  const title = escapeHtml(preview.title);
  const description = escapeHtml(preview.description);
  const pageUrl = escapeHtml(preview.pageUrl);
  const imageUrl = escapeHtml(preview.imageUrl);
  const imageAlt = escapeHtml(preview.imageAlt);
  const details = preview.details
    .map((line) => `    <p>${escapeHtml(line)}</p>`)
    .join("\n");
  const pageTitle = preview.indexable ? `${title} | ${SITE_NAME}` : title;
  const linkLabel = preview.indexable
    ? "Open in CalEvents"
    : "Browse upcoming events";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${pageTitle}</title>
    <meta name="description" content="${description}" />
    <meta name="robots" content="${preview.indexable ? "index, follow" : "noindex"}" />
    <link rel="canonical" href="${pageUrl}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="${SITE_NAME}" />
    <meta property="og:url" content="${pageUrl}" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:image" content="${imageUrl}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${imageAlt}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />
    <meta name="twitter:image" content="${imageUrl}" />
  </head>
  <body>
    <h1>${title}</h1>
${details}
    <p>${description}</p>
    <p><a href="${pageUrl}">${linkLabel}</a></p>
  </body>
</html>
`;
}
