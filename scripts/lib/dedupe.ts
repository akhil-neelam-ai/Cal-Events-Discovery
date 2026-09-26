/**
 * Cross-source dedupe.
 *
 * Strategy: bucket by (normalized_title, date). Within a bucket, keep the
 * highest-priority source. Source priority reflects data quality:
 *   livewhale (structured iCal) > callink/cal_performances/calbears (JSON APIs)
 */

import type { CanonicalEvent, LegacyCalEvent, SourceName } from "./schema.js";
import { firstOccurrencePT, normalizeForDedupe } from "./normalize.js";

const SOURCE_PRIORITY: Record<SourceName, number> = {
  livewhale: 4,
  callink: 3,
  cal_performances: 3,
  calbears: 3,
  bampfa: 3,
  // Haas and Berkeley Law run The Events Calendar (Tribe) on WordPress —
  // structured JSON is higher-quality than HTML scraping, on par with the
  // other JSON-API sources. Below livewhale because the central feed is a
  // superset for any events that happen to be cross-published.
  haas: 3,
  berkeley_law: 3,
  simons: 3,
  luma: 3,
  begin: 3,
  ai_risk: 3,
  brsl: 3,
};

export interface DedupeResult {
  events: CanonicalEvent[];
  duplicatesRemoved: number;
}

function dedupeKey(event: CanonicalEvent): string {
  // A span that started before today is keyed on today, the day it is
  // published under, so it still meets another source's copy.
  const date = firstOccurrencePT(event);
  const normalizedTitle = normalizeForDedupe(event.title);
  const identity = normalizedTitle
    ? ["title", normalizedTitle]
    : ["source", event.source_name, event.source_id];

  return JSON.stringify([...identity, date]);
}

/**
 * Same-priority tie-break: pick a stable winner that does not depend on which
 * candidate arrived first in upstream API order. Otherwise the published event
 * id (`${source_name}_${source_id}`) can silently flip whenever an upstream
 * re-sorts its response, breaking yesterday's `?event=<id>` deep links.
 *
 * Order: alphabetical `source_name`, then alphabetical `source_id`.
 */
function tieBreak(a: CanonicalEvent, b: CanonicalEvent): CanonicalEvent {
  const sourceCmp = a.source_name.localeCompare(b.source_name);
  if (sourceCmp !== 0) return sourceCmp < 0 ? a : b;
  const idCmp = a.source_id.localeCompare(b.source_id);
  return idCmp <= 0 ? a : b;
}

export function dedupeEvents(events: CanonicalEvent[]): DedupeResult {
  const buckets = new Map<string, CanonicalEvent>();

  for (const event of events) {
    const key = dedupeKey(event);
    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, event);
      continue;
    }
    const ep = SOURCE_PRIORITY[event.source_name];
    const xp = SOURCE_PRIORITY[existing.source_name];
    let winner: CanonicalEvent;
    if (ep > xp) {
      winner = event;
    } else if (ep < xp) {
      winner = existing;
    } else {
      winner = tieBreak(event, existing);
    }
    buckets.set(key, winner);
  }

  const deduped = Array.from(buckets.values());
  return {
    events: deduped,
    duplicatesRemoved: events.length - deduped.length,
  };
}

function publishedDedupeKey(event: LegacyCalEvent, today: string): string {
  // A restored multi-day row keeps yesterday's `date`, so key on its first
  // day from today on, the day a fresh copy would be published under.
  const [first] = (event.dates ?? [event.date])
    .filter((day) => day >= today)
    .sort();
  const normalizedTitle = normalizeForDedupe(event.title);
  const identity = normalizedTitle
    ? ["title", normalizedTitle]
    : ["id", event.id];
  return JSON.stringify([...identity, first ?? event.date]);
}

function pickPublished(a: LegacyCalEvent, b: LegacyCalEvent): LegacyCalEvent {
  const ap = SOURCE_PRIORITY[a.source as SourceName] ?? 0;
  const bp = SOURCE_PRIORITY[b.source as SourceName] ?? 0;
  if (ap !== bp) return ap > bp ? a : b;
  const sourceCmp = a.source.localeCompare(b.source);
  if (sourceCmp !== 0) return sourceCmp < 0 ? a : b;
  return a.id.localeCompare(b.id) <= 0 ? a : b;
}

/**
 * Last-good restores skip `dedupeEvents`, so a restored copy can meet a
 * lower-priority copy of the same event published today. This runs the same
 * title-and-date key over published rows, only for groups that hold a
 * restored row, and keeps the higher-priority copy. A restored LiveWhale row
 * beats a fresh Haas row, which keeps yesterday's `?event=` links working.
 */
export function dedupeRestoredEvents(
  events: LegacyCalEvent[],
  restoredIds: ReadonlySet<string>,
  today: string,
): LegacyCalEvent[] {
  if (restoredIds.size === 0) return events;

  const buckets = new Map<string, LegacyCalEvent[]>();
  for (const event of events) {
    const key = publishedDedupeKey(event, today);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(event);
    } else {
      buckets.set(key, [event]);
    }
  }

  const dropped = new Set<LegacyCalEvent>();
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;
    if (!bucket.some((event) => restoredIds.has(event.id))) continue;
    const winner = bucket.reduce(pickPublished);
    for (const event of bucket) {
      if (event !== winner) dropped.add(event);
    }
  }

  return dropped.size === 0
    ? events
    : events.filter((event) => !dropped.has(event));
}
