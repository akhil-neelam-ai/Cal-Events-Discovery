/**
 * Cross-source dedupe.
 *
 * Strategy: bucket by (normalized_title, date). Within a bucket, keep the
 * highest-priority source. Source priority reflects data quality:
 *   livewhale (structured iCal) > callink/cal_performances/calbears (JSON APIs) > ehub (parsed HTML)
 */

import type { CanonicalEvent, SourceName } from "./schema.js";
import { isoDateInPT, normalizeForDedupe } from "./normalize.js";

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
  ehub: 2,
};

export interface DedupeResult {
  events: CanonicalEvent[];
  duplicatesRemoved: number;
}

function dedupeKey(event: CanonicalEvent): string {
  const date = isoDateInPT(event.start_at);
  const normalizedTitle = normalizeForDedupe(event.title);
  const identity = normalizedTitle
    ? ["title", normalizedTitle]
    : ["source", event.source_name, event.source_id];

  return JSON.stringify([...identity, date]);
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
    const winner =
      SOURCE_PRIORITY[event.source_name] > SOURCE_PRIORITY[existing.source_name]
        ? event
        : existing;
    buckets.set(key, winner);
  }

  const deduped = Array.from(buckets.values());
  return {
    events: deduped,
    duplicatesRemoved: events.length - deduped.length,
  };
}
