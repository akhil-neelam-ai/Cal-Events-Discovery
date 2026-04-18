/**
 * Normalization helpers shared across source adapters.
 * - Title cleanup
 * - Category inference (maps source-specific categories → frontend tags)
 * - Date / time projection from start_at + timezone for the legacy shape
 */

import type { CanonicalEvent, LegacyCalEvent } from './schema.js';

const FRONTEND_CATEGORIES = [
  'Academic',
  'Arts',
  'Sports',
  'Science & Tech',
  'Student Life',
  'Entrepreneurship',
] as const;
export type FrontendCategory = (typeof FRONTEND_CATEGORIES)[number];

const KEYWORD_TO_CATEGORY: Array<[RegExp, FrontendCategory]> = [
  [/\b(seminar|colloquium|lecture|symposium|talk|panel|guest speaker|defense|dissertation)\b/i, 'Academic'],
  [/\b(concert|recital|performance|exhibit|gallery|film|screening|theatre|theater|dance|opera|bampfa|cal performances)\b/i, 'Arts'],
  [/\b(basketball|football|baseball|softball|soccer|volleyball|swim|track|tennis|gymnastics|water polo|rugby|lacrosse|game vs|cal bears|intramural|rec sports)\b/i, 'Sports'],
  [/\b(ai|machine learning|data science|computer science|engineering|robotics|biotech|genomics|physics|chemistry|biology|stem|hackathon|cs |eecs)\b/i, 'Science & Tech'],
  [/\b(startup|entrepreneur|founder|venture|pitch|demo day|skydeck|berkeley haas|e-?hub|product management|innovation)\b/i, 'Entrepreneurship'],
  [/\b(club|social|mixer|orientation|workshop|career|networking|student org|grad student|undergrad)\b/i, 'Student Life'],
];

export function inferCategory(event: { title: string; description: string; categories: string[]; organizer: string }): FrontendCategory {
  const haystack = [event.title, event.description, ...event.categories, event.organizer].join(' ');
  for (const [pattern, category] of KEYWORD_TO_CATEGORY) {
    if (pattern.test(haystack)) return category;
  }
  return 'Academic';
}

export function cleanTitle(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, '')
    .trim();
}

const TZ = 'America/Los_Angeles';

export function isoDateInPT(start_at: string): string {
  // For all-day VEVENTs, start_at is YYYY-MM-DD already.
  if (/^\d{4}-\d{2}-\d{2}$/.test(start_at)) return start_at;
  const d = new Date(start_at);
  if (isNaN(d.getTime())) return '';
  // Use Intl to get the date in Pacific time (handles DST)
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(d); // en-CA gives YYYY-MM-DD
}

export function displayTime(start_at: string, all_day: boolean): string {
  if (all_day) return 'All day';
  if (/^\d{4}-\d{2}-\d{2}$/.test(start_at)) return 'All day';
  const d = new Date(start_at);
  if (isNaN(d.getTime())) return 'TBD';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d);
}

export function projectToLegacy(event: CanonicalEvent): LegacyCalEvent {
  const date = isoDateInPT(event.start_at);
  const time = displayTime(event.start_at, event.all_day);
  const location = [event.venue, event.building].filter(Boolean).join(' — ') || event.address || 'Berkeley, CA';
  const tags = event.tags.length > 0 ? event.tags : [inferCategory(event)];
  const id = `${event.source_name}_${event.source_id}`;
  return {
    id,
    title: cleanTitle(event.title),
    organizer: event.organizer || event.organizer_unit || 'UC Berkeley',
    date,
    time,
    location,
    description: event.description || event.title,
    tags,
    url: event.canonical_url || event.source_url,
  };
}

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'with',
  'by', 'from', 'is', 'as', 'vs', 'vs.', '&',
]);

export function normalizeForDedupe(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter(w => w && !STOPWORDS.has(w))
    .join(' ');
}
