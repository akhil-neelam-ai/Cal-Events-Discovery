import Fuse from 'fuse.js';
import type { CalEvent } from '../types';
import { tokenize, stem } from './textUtils';
import type { SearchIndex } from './textUtils';

export type { SearchIndex };

// ─── Intent parsing ───────────────────────────────────────────────────────────

export interface QueryIntent {
  dateRange?: 'today' | 'week';
  category?: string;
}

export interface ParsedQuery {
  raw: string;
  /** Query text after intent phrases are stripped */
  cleaned: string;
  tokens: string[];
  intents: QueryIntent;
}

const RE_TODAY   = /\b(tonight|today|this evening|this afternoon|this morning)\b/i;
const RE_WEEK    = /\b(this week|next 7 days|this weekend|weekend)\b/i;
const RE_SPORTS  = /\b(cal game|bears game|cal bears|athletics|sport|sports)\b/i;
const RE_ARTS    = /\b(film screening|movie|concert|performance|theater|theatre|gallery|bampfa)\b/i;
const RE_TECH    = /\b(ai talk|ai talks|tech talk|hackathon|coding|computer science)\b/i;
const RE_STUDENT = /\b(free food|student org|greek|frat|sorority)\b/i;

export function parseQuery(query: string): ParsedQuery {
  const raw = query.trim();
  const intents: QueryIntent = {};
  let cleaned = raw;

  if (RE_TODAY.test(raw)) {
    intents.dateRange = 'today';
    cleaned = cleaned.replace(RE_TODAY, '').trim();
  } else if (RE_WEEK.test(raw)) {
    intents.dateRange = 'week';
    cleaned = cleaned.replace(RE_WEEK, '').trim();
  }

  if (RE_SPORTS.test(raw))       intents.category = 'Sports';
  else if (RE_ARTS.test(raw))    intents.category = 'Arts';
  else if (RE_TECH.test(raw))    intents.category = 'Science & Tech';
  else if (RE_STUDENT.test(raw)) intents.category = 'Student Life';

  const tokens = tokenize(cleaned || raw);
  return { raw, cleaned, tokens, intents };
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

const W = { title: 60, titlePhrase: 100, tag: 45, org: 30, desc: 10, recency: 15 } as const;
const ALL_DAY_TIME_ZONE = 'America/Los_Angeles';
const ALL_DAY_START_HOUR_PT = 8;

function getRecencyReference(dateStr: string): number {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [year, month, day] = dateStr.split('-').map(Number);
    if (!year || !month || !day) {
      return Number.NaN;
    }

    // All-day dates are published in PT calendar days. Anchor them to 8 AM PT so
    // the recency window does not shift backward when the browser parses them as UTC.
    const utcHour = new Intl.DateTimeFormat('en-US', {
      timeZone: ALL_DAY_TIME_ZONE,
      hour: 'numeric',
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(Date.UTC(year, month - 1, day, ALL_DAY_START_HOUR_PT))).find(part => part.type === 'hour')?.value;

    const ptOffsetHours = utcHour ? ALL_DAY_START_HOUR_PT - Number(utcHour) : 7;
    return Date.UTC(year, month - 1, day, ALL_DAY_START_HOUR_PT - ptOffsetHours);
  }

  return new Date(dateStr).getTime();
}

function recencyBonus(dateStr: string): number {
  try {
    const referenceMs = getRecencyReference(dateStr);
    if (!Number.isFinite(referenceMs)) return 0;
    const ms = referenceMs - Date.now();
    const days = ms / 86_400_000;
    if (days < 0 || days > 30) return 0;
    return Math.round(W.recency * (1 - days / 30));
  } catch {
    return 0;
  }
}

function scoreByPos(
  pos: number,
  queryTokens: string[],
  rawQuery: string,
  index: SearchIndex,
  eventByPos: (p: number) => CalEvent | undefined,
): number {
  const ev = eventByPos(pos);
  if (!ev) return 0;

  let score = 0;
  let matched = 0;

  if (rawQuery && ev.title.toLowerCase().includes(rawQuery.toLowerCase())) {
    score += W.titlePhrase;
    matched++;
  }

  for (const qt of queryTokens) {
    if (index.t[qt]?.includes(pos)) { score += W.title; matched++; }
    if (index.g[qt]?.includes(pos)) { score += W.tag;   matched++; }
    if (index.o[qt]?.includes(pos)) { score += W.org;   matched++; }
    if (index.d[qt]?.includes(pos)) { score += W.desc;  matched++; }
  }

  if (matched === 0) return 0;
  score += recencyBonus(ev.date);
  return score;
}

// ─── Main search function ─────────────────────────────────────────────────────

export interface SearchResult {
  event: CalEvent;
  score: number;
}

export function searchEvents(
  events: CalEvent[],
  query: string,
  index: SearchIndex | null,
): { results: CalEvent[]; intents: QueryIntent; matchedTokens: string[] } {
  if (!query.trim()) return { results: events, intents: {}, matchedTokens: [] };

  const { tokens, intents, raw } = parseQuery(query);
  if (tokens.length === 0 && !raw) return { results: events, intents, matchedTokens: [] };

  // Build a position-based lookup for the current filtered pool.
  // The published index stores positions against the full snapshot, so we
  // cannot assume index position === events[] position once category/source
  // filters have narrowed the pool.
  const eventPosById = new Map<string, number>();
  if (index) {
    index.ids.forEach((id, pos) => {
      eventPosById.set(id, pos);
    });
  }
  const scored: SearchResult[] = [];
  const scoredIds = new Set<string>();

  // Phase 1: inverted index lookup + field-weight scoring
  if (index && tokens.length > 0) {
    const candidatePos = new Set<number>();
    for (const token of tokens) {
      for (const pos of index.t[token] ?? []) candidatePos.add(pos);
      for (const pos of index.g[token] ?? []) candidatePos.add(pos);
      for (const pos of index.o[token] ?? []) candidatePos.add(pos);
      for (const pos of index.d[token] ?? []) candidatePos.add(pos);
    }

    const posToEvent = new Map<number, CalEvent>();
    for (const event of events) {
      const pos = eventPosById.get(event.id);
      if (typeof pos === 'number' && candidatePos.has(pos)) {
        posToEvent.set(pos, event);
      }
    }

    const eventByPos = (pos: number) => posToEvent.get(pos);

    for (const [pos, ev] of posToEvent.entries()) {
      if (!ev) continue;
      const score = scoreByPos(pos, tokens, raw, index, eventByPos);
      if (score > 0) {
        scored.push({ event: ev, score });
        scoredIds.add(ev.id);
      }
    }
  }

  // Phase 2: Fuse.js fuzzy fallback
  // — runs on un-indexed tokens, or as the sole engine when index is null
  const tokensWithHits = index
    ? new Set(tokens.filter(t =>
        (index.t[t]?.length ?? 0) > 0 ||
        (index.g[t]?.length ?? 0) > 0 ||
        (index.o[t]?.length ?? 0) > 0 ||
        (index.d[t]?.length ?? 0) > 0
      ))
    : new Set<string>();
  const fuzzyTokens = tokens.filter(t => !tokensWithHits.has(t));

  if (fuzzyTokens.length > 0 || scored.length === 0) {
    const fuzzyPool = scored.length === 0 ? events : events.filter(e => !scoredIds.has(e.id));
    const fuse = new Fuse(fuzzyPool, {
      keys: [
        { name: 'title',       weight: 4 },
        { name: 'tags',        weight: 3 },
        { name: 'organizer',   weight: 2 },
        { name: 'description', weight: 1 },
      ],
      threshold: 0.4,
      includeScore: true,
      minMatchCharLength: 2,
    });

    const fuseQuery = fuzzyTokens.length > 0 ? fuzzyTokens.join(' ') : raw;
    for (const { item, score: fs } of fuse.search(fuseQuery)) {
      const relevance = Math.round((1 - (fs ?? 1)) * 40) + recencyBonus(item.date);
      if (scoredIds.has(item.id)) {
        const existing = scored.find(r => r.event.id === item.id);
        if (existing) existing.score += relevance;
      } else {
        scored.push({ event: item, score: relevance });
      }
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return {
    results: scored.map(r => r.event),
    intents,
    matchedTokens: tokens,
  };
}

const SYNONYMS: Record<string, string> = {
  ai: 'artificial intelligence machine learning',
  ml: 'machine learning artificial intelligence',
  film: 'movie cinema screening',
  concert: 'music performance recital',
  talk: 'lecture seminar presentation speaker',
  workshop: 'class training hands-on session',
  career: 'job employment networking recruiting',
};

function expandQueryTokens(tokens: string[]): string[] {
  const expanded = new Set(tokens);
  for (const token of tokens) {
    const synonymText = SYNONYMS[token];
    if (!synonymText) continue;
    for (const synonymToken of tokenize(synonymText)) {
      expanded.add(synonymToken);
    }
  }
  return Array.from(expanded);
}

// Re-export stem for consumers that need it
export { stem, tokenize };
