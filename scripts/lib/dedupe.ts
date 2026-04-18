/**
 * Cross-source dedupe.
 *
 * Strategy: bucket by (normalized_title, date). Within a bucket, keep the
 * highest-priority source. Source priority reflects data quality:
 *   livewhale (structured iCal) > ehub (parsed HTML) > gemini (LLM extraction)
 */

import type { CanonicalEvent, SourceName } from './schema.js';
import { isoDateInPT, normalizeForDedupe } from './normalize.js';

const SOURCE_PRIORITY: Record<SourceName, number> = {
  livewhale: 3,
  ehub: 2,
  gemini: 1,
};

export interface DedupeResult {
  events: CanonicalEvent[];
  duplicatesRemoved: number;
}

export function dedupeEvents(events: CanonicalEvent[]): DedupeResult {
  const buckets = new Map<string, CanonicalEvent>();

  for (const event of events) {
    const date = isoDateInPT(event.start_at);
    const key = `${normalizeForDedupe(event.title)}::${date}`;
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
