/**
 * Build-time inverted index generator.
 * Called by updateEvents.ts after writing public/events.json.
 * Output: public/search-index.json
 *
 * Fields indexed:
 *   t = title          (weight 60 at query time)
 *   g = tags           (weight 45)
 *   o = organizer      (weight 30)
 *   l = location       (weight 20)
 *   d = description    (weight 10, full text — not truncated)
 *
 * Also expands Berkeley venue aliases so queries like "bampfa" or "moffitt"
 * hit the right events even if the event text spells them differently.
 */

import type { LegacyCalEvent } from './schema.js';
import { tokenize } from '../../utils/textUtils.js';
import { BERKELEY_VENUE_ALIASES } from '../../utils/textUtils.js';
import type { SearchIndex } from '../../utils/textUtils.js';

export type { SearchIndex };

type FieldMap = Record<string, Set<number>>;

function add(map: FieldMap, token: string, pos: number) {
  if (!map[token]) map[token] = new Set();
  map[token].add(pos);
}

function finalise(map: FieldMap): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const [token, posSet] of Object.entries(map)) {
    out[token] = [...posSet].sort((a, b) => a - b);
  }
  return out;
}

/** Tokenize text and also inject alias expansions for known Berkeley venues. */
function tokenizeWithAliases(text: string): string[] {
  const base = tokenize(text);
  const lower = text.toLowerCase();
  const extra: string[] = [];
  for (const [alias, expansion] of Object.entries(BERKELEY_VENUE_ALIASES)) {
    if (lower.includes(alias)) {
      extra.push(...tokenize(expansion));
    }
  }
  return [...new Set([...base, ...extra])];
}

export function buildSearchIndex(events: LegacyCalEvent[]): SearchIndex {
  const ids: string[] = events.map(e => e.id);
  const t: FieldMap = {};
  const g: FieldMap = {};
  const o: FieldMap = {};
  const d: FieldMap = {};
  const l: FieldMap = {};

  for (let pos = 0; pos < events.length; pos++) {
    const ev = events[pos];

    for (const token of tokenizeWithAliases(ev.title))               add(t, token, pos);
    for (const token of tokenize((ev.tags ?? []).join(' ')))          add(g, token, pos);
    for (const token of tokenizeWithAliases(ev.organizer ?? ''))      add(o, token, pos);
    for (const token of tokenizeWithAliases(ev.location ?? ''))       add(l, token, pos);
    for (const token of tokenize(ev.description ?? ''))               add(d, token, pos);
  }

  return {
    ids,
    t: finalise(t),
    g: finalise(g),
    o: finalise(o),
    d: finalise(d),
    l: finalise(l),
    buildAt: new Date().toISOString(),
    eventCount: events.length,
  };
}
