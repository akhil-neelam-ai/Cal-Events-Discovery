/**
 * Build-time inverted index generator.
 * Called by updateEvents.ts after writing public/events.json.
 * Output: public/search-index.json
 *
 * Uses numeric positions (into `ids` array) instead of string event IDs,
 * reducing JSON size ~5x compared to storing full ID strings per entry.
 */

import type { LegacyCalEvent } from './schema.js';
import { tokenize } from '../../utils/textUtils.js';
import type { SearchIndex } from '../../utils/textUtils.js';

export type { SearchIndex };

type FieldMap = Record<string, Set<number>>;

function add(map: FieldMap, stem: string, pos: number) {
  if (!map[stem]) map[stem] = new Set();
  map[stem].add(pos);
}

function finalise(map: FieldMap): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const [stem, posSet] of Object.entries(map)) {
    out[stem] = [...posSet].sort((a, b) => a - b);
  }
  return out;
}

export function buildSearchIndex(
  events: LegacyCalEvent[],
  buildAt = new Date().toISOString(),
): SearchIndex {
  const ids: string[] = events.map(e => e.id);
  const t: FieldMap = {};
  const g: FieldMap = {};
  const o: FieldMap = {};
  const d: FieldMap = {};

  for (let pos = 0; pos < events.length; pos++) {
    const ev = events[pos];
    for (const stem of tokenize(ev.title))                           add(t, stem, pos);
    for (const stem of tokenize((ev.tags ?? []).join(' ')))          add(g, stem, pos);
    for (const stem of tokenize(ev.organizer ?? ''))                 add(o, stem, pos);
    for (const stem of tokenize((ev.description ?? '').slice(0, 150))) add(d, stem, pos);
  }

  return {
    ids,
    t: finalise(t),
    g: finalise(g),
    o: finalise(o),
    d: finalise(d),
    buildAt,
    eventCount: events.length,
  };
}
