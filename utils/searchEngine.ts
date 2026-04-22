import Fuse from "fuse.js";
import type { CalEvent } from "../types";
import {
  tokenize,
  stem,
  DOMAIN_SYNONYMS,
  BERKELEY_VENUE_ALIASES,
} from "./textUtils";
import type { SearchIndex } from "./textUtils";

export type { SearchIndex };

// ─── SearchPlan ───────────────────────────────────────────────────────────────

export interface SearchFilter {
  dateRange?: "today" | "tomorrow" | "week" | "upcoming";
  timeOfDay?: "morning" | "afternoon" | "evening";
  category?: string;
  campusArea?: "northside" | "southside" | "downtown";
  free?: boolean;
  modality?: "online" | "in-person";
}

export interface InterpretedChip {
  key: string; // 'dateRange:week', 'category:Arts', etc.
  label: string; // human-readable: 'This Week', 'Arts'
}

export interface SearchPlan {
  raw: string;
  cleaned: string;
  keywords: string[]; // core stems from cleaned query
  expandedTokens: string[]; // keywords + synonym expansions
  phrases: string[]; // detected multi-word phrases
  filters: SearchFilter;
  interpretations: InterpretedChip[];
}

// ─── Pattern library ──────────────────────────────────────────────────────────

const RE_TODAY =
  /\b(tonight|today|this evening|this afternoon|this morning)\b/i;
const RE_TOMORROW = /\b(tomorrow|tmrw|tmr)\b/i;
const RE_WEEK = /\b(this week|next 7 days|this weekend|weekend)\b/i;
const RE_UPCOMING = /\b(upcoming|next month|coming up|soon)\b/i;

const RE_MORNING = /\b(morning|breakfast|early morning)\b/i;
const RE_AFTERNOON =
  /\b(afternoon|lunch|midday|after class|after lunch|noon)\b/i;
const RE_EVENING = /\b(evening|after work|after 5|nighttime)\b/i;

const RE_FREE = /\bfree\b(?!\s*(?:throw|agent|range|radical|speech))/i;
const RE_ONLINE = /\b(online|virtual|zoom|remote|webinar|livestream)\b/i;
const RE_INPERSON = /\b(in.?person|on campus|in.?person)\b/i;

// Category patterns — first match wins
const CATEGORY_PATTERNS: Array<[string, RegExp]> = [
  [
    "Entrepreneurship",
    /\b(startup|founder|venture|pitch|demo day|skydeck|entrepreneur|entrepreneurship|product management|innovation hub)\b/i,
  ],
  [
    "Sports",
    /\b(cal game|bears game|cal bears|athletics|basketball|football|baseball|volleyball|soccer|swim meet|swim team|tennis|gymnastics|rowing|crew|sports)\b/i,
  ],
  [
    "Arts",
    /\b(film screening|film|movie|concert|performance|theater|theatre|gallery|bampfa|dance|opera|recital|exhibition|exhibit|museum)\b/i,
  ],
  [
    "Science & Tech",
    /\b(ai\b|machine learning|data science|hackathon|coding|computer science|eecs|engineering talk|robotics|biotech|genomics|tech talk)\b/i,
  ],
  [
    "Student Life",
    /\b(free food|student org|club|social|mixer|orientation|undergrad|grad student|tabling|info session|open house|coffee chat)\b/i,
  ],
  [
    "Academic",
    /\b(seminar|colloquium|lecture|symposium|dissertation defense|dissertation|thesis defense|guest speaker|research talk|keynote)\b/i,
  ],
];

// Campus area patterns
const AREA_PATTERNS: Array<[SearchFilter["campusArea"], RegExp, string]> = [
  [
    "northside",
    /\b(northside|north side|northgate|euclid|hearst|north campus)\b/i,
    "Northside",
  ],
  [
    "southside",
    /\b(southside|south side|telegraph|south campus)\b/i,
    "Southside",
  ],
  ["downtown", /\b(downtown berkeley|shattuck|bart)\b/i, "Downtown"],
];

// Known multi-word phrases to detect and boost
const KNOWN_PHRASES = [
  "free food",
  "film screening",
  "career fair",
  "startup founder",
  "guest speaker",
  "study group",
  "coffee chat",
  "info session",
  "open house",
  "demo day",
  "tech talk",
  "research talk",
  "panel discussion",
  "happy hour",
  "game night",
  "networking event",
  "dissertation defense",
  "job fair",
  "book club",
  "startup pitch",
  "venture capital",
  "data science",
  "machine learning",
];

// ─── buildSearchPlan ──────────────────────────────────────────────────────────

export function buildSearchPlan(query: string): SearchPlan {
  const raw = query.trim();
  const filters: SearchFilter = {};
  const interpretations: InterpretedChip[] = [];
  const phrases: string[] = [];
  let cleaned = raw;

  if (!raw) {
    return {
      raw,
      cleaned,
      keywords: [],
      expandedTokens: [],
      phrases,
      filters,
      interpretations,
    };
  }

  // ── Temporal ──────────────────────────────────────────────────────────────
  if (RE_TODAY.test(raw)) {
    filters.dateRange = "today";
    interpretations.push({ key: "dateRange:today", label: "Today" });
    cleaned = cleaned.replace(RE_TODAY, "").trim();
  } else if (RE_TOMORROW.test(raw)) {
    filters.dateRange = "tomorrow";
    interpretations.push({ key: "dateRange:tomorrow", label: "Tomorrow" });
    cleaned = cleaned.replace(RE_TOMORROW, "").trim();
  } else if (RE_WEEK.test(raw)) {
    filters.dateRange = "week";
    interpretations.push({ key: "dateRange:week", label: "This Week" });
    cleaned = cleaned.replace(RE_WEEK, "").trim();
  } else if (RE_UPCOMING.test(raw)) {
    filters.dateRange = "upcoming";
    interpretations.push({ key: "dateRange:upcoming", label: "Upcoming" });
    cleaned = cleaned.replace(RE_UPCOMING, "").trim();
  }

  // ── Time of day ───────────────────────────────────────────────────────────
  if (!filters.dateRange && RE_MORNING.test(raw)) {
    filters.timeOfDay = "morning";
    interpretations.push({ key: "timeOfDay:morning", label: "Morning" });
  } else if (RE_AFTERNOON.test(raw)) {
    filters.timeOfDay = "afternoon";
    interpretations.push({ key: "timeOfDay:afternoon", label: "Afternoon" });
  } else if (RE_EVENING.test(raw)) {
    filters.timeOfDay = "evening";
    interpretations.push({ key: "timeOfDay:evening", label: "Evening" });
  }

  // ── Modality ──────────────────────────────────────────────────────────────
  if (RE_ONLINE.test(raw)) {
    filters.modality = "online";
    interpretations.push({ key: "modality:online", label: "Online" });
    cleaned = cleaned.replace(RE_ONLINE, "").trim();
  } else if (RE_INPERSON.test(raw)) {
    filters.modality = "in-person";
    interpretations.push({ key: "modality:in-person", label: "In Person" });
    cleaned = cleaned.replace(RE_INPERSON, "").trim();
  }

  // ── Free ──────────────────────────────────────────────────────────────────
  if (RE_FREE.test(raw)) {
    filters.free = true;
    interpretations.push({ key: "free:true", label: "Free" });
  }

  // ── Category ─────────────────────────────────────────────────────────────
  for (const [category, pattern] of CATEGORY_PATTERNS) {
    if (pattern.test(raw)) {
      filters.category = category;
      interpretations.push({ key: `category:${category}`, label: category });
      break;
    }
  }

  // ── Campus area ───────────────────────────────────────────────────────────
  // (detection kept for future use, but chip intentionally not shown — filter
  //  is not yet applied in applyPoolFilters, so showing a chip would be misleading)
  for (const [area, pattern] of AREA_PATTERNS) {
    if (pattern.test(raw)) {
      filters.campusArea = area;
      const label =
        area === "northside"
          ? "Northside"
          : area === "southside"
            ? "Southside"
            : "Downtown";
      interpretations.push({ key: `campusArea:${area}`, label });
      cleaned = cleaned.replace(pattern, "").trim();
      break;
    }
  }

  // ── Known phrases ─────────────────────────────────────────────────────────
  const rawLower = raw.toLowerCase();
  for (const phrase of KNOWN_PHRASES) {
    if (rawLower.includes(phrase)) phrases.push(phrase);
  }

  // ── Keywords ──────────────────────────────────────────────────────────────
  const keywords = tokenize(
    cleaned || (interpretations.length === 0 ? raw : ""),
  );

  // ── Synonym expansion ─────────────────────────────────────────────────────
  const expandedSet = new Set<string>(keywords);

  // Multi-word synonyms (e.g. "free food")
  for (const [phrase, syns] of Object.entries(DOMAIN_SYNONYMS)) {
    if (phrase.includes(" ") && rawLower.includes(phrase)) {
      for (const s of syns) tokenize(s).forEach((t) => expandedSet.add(t));
    }
  }
  // Single-word synonyms
  for (const kw of keywords) {
    const syns = DOMAIN_SYNONYMS[kw];
    if (syns) {
      for (const s of syns) tokenize(s).forEach((t) => expandedSet.add(t));
    }
  }
  // Berkeley venue alias expansions
  for (const [alias, expansion] of Object.entries(BERKELEY_VENUE_ALIASES)) {
    if (rawLower.includes(alias)) {
      tokenize(expansion).forEach((t) => expandedSet.add(t));
    }
  }

  const expandedTokens = Array.from(expandedSet);

  return {
    raw,
    cleaned,
    keywords,
    expandedTokens,
    phrases,
    filters,
    interpretations,
  };
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

const W = {
  titlePhrase: 100,
  phraseMatch: 70,
  title: 60,
  tag: 45,
  org: 30,
  location: 20,
  desc: 10,
  recency: 15,
  categoryBoost: 25,
  coreMultiplier: 1.0,
  synMultiplier: 0.55, // synonyms score lower than core tokens
} as const;

function recencyBonus(dateStr: string): number {
  try {
    const ms = new Date(dateStr).getTime() - Date.now();
    const days = ms / 86_400_000;
    if (days < 0 || days > 30) return 0;
    return Math.round(W.recency * (1 - days / 30));
  } catch {
    return 0;
  }
}

function parseHour(timeStr: string): number | null {
  const m = timeStr.match(/(\d+):?\d*\s*(am|pm)/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  if (m[2].toLowerCase() === "pm" && h !== 12) h += 12;
  if (m[2].toLowerCase() === "am" && h === 12) h = 0;
  return h;
}

function scoreEvent(
  pos: number,
  plan: SearchPlan,
  index: SearchIndex,
  eventByPos: (p: number) => CalEvent | undefined,
): number {
  const ev = eventByPos(pos);
  if (!ev) return 0;

  let score = 0;
  let matched = 0;

  // Exact raw phrase in title
  if (plan.raw && ev.title.toLowerCase().includes(plan.raw.toLowerCase())) {
    score += W.titlePhrase;
    matched++;
  }
  // Known phrase matches
  for (const phrase of plan.phrases) {
    const text = `${ev.title} ${ev.description ?? ""}`.toLowerCase();
    if (text.includes(phrase)) {
      score += W.phraseMatch;
      matched++;
    }
  }

  // Field-weighted token scoring
  for (const qt of plan.expandedTokens) {
    const isCore = plan.keywords.includes(qt);
    const mult = isCore ? W.coreMultiplier : W.synMultiplier;

    if (index.t[qt]?.includes(pos)) {
      score += W.title * mult;
      matched++;
    }
    if (index.g[qt]?.includes(pos)) {
      score += W.tag * mult;
      matched++;
    }
    if (index.o[qt]?.includes(pos)) {
      score += W.org * mult;
      matched++;
    }
    if (index.l[qt]?.includes(pos)) {
      score += W.location * mult;
      matched++;
    }
    if (index.d[qt]?.includes(pos)) {
      score += W.desc * mult;
      matched++;
    }
  }

  if (matched === 0) return 0;

  // Category boost
  if (plan.filters.category) {
    const evCat = ev.tags?.[0] ?? "";
    if (evCat.toLowerCase() === plan.filters.category.toLowerCase()) {
      score += W.categoryBoost;
    }
  }

  score += recencyBonus(ev.date);
  return score;
}

// ─── Pool filters (hard constraints from plan) ────────────────────────────────

function applyPoolFilters(
  events: CalEvent[],
  plan: SearchPlan,
  dismissedKeys: Set<string>,
): CalEvent[] {
  const { filters } = plan;
  return events.filter((ev) => {
    if (
      filters.campusArea &&
      !dismissedKeys.has(`campusArea:${filters.campusArea}`)
    ) {
      const haystack =
        `${ev.location ?? ""} ${ev.description ?? ""} ${ev.organizer ?? ""}`.toLowerCase();
      const areaPattern = AREA_PATTERNS.find(
        ([area]) => area === filters.campusArea,
      )?.[1];
      if (areaPattern && !areaPattern.test(haystack)) {
        return false;
      }
    }
    // Time-of-day: soft hard filter — only when explicitly detected
    if (
      filters.timeOfDay &&
      !dismissedKeys.has(`timeOfDay:${filters.timeOfDay}`) &&
      ev.time
    ) {
      const hour = parseHour(ev.time);
      if (hour !== null) {
        if (filters.timeOfDay === "morning" && hour >= 12) return false;
        if (filters.timeOfDay === "afternoon" && (hour < 12 || hour >= 17))
          return false;
        if (filters.timeOfDay === "evening" && hour < 17) return false;
      }
    }
    // Free events
    if (filters.free && !dismissedKeys.has("free:true")) {
      const text = `${ev.title} ${ev.description ?? ""}`.toLowerCase();
      if (!/\bfree\b/.test(text)) return false;
    }
    // Modality
    if (
      filters.modality &&
      !dismissedKeys.has(`modality:${filters.modality}`)
    ) {
      const text =
        `${ev.title} ${ev.location} ${ev.description ?? ""}`.toLowerCase();
      if (
        filters.modality === "online" &&
        !/\b(online|virtual|zoom|remote|webinar)\b/.test(text)
      )
        return false;
      if (
        filters.modality === "in-person" &&
        /\b(online|virtual|zoom|remote|webinar)\b/.test(text)
      )
        return false;
    }
    return true;
  });
}

// ─── Core scorer ──────────────────────────────────────────────────────────────

function runScoring(
  pool: CalEvent[],
  plan: SearchPlan,
  index: SearchIndex | null,
): CalEvent[] {
  // When the query is purely a temporal/intent signal (e.g. "today", "this week"),
  // cleaned produces no keywords. Return pool unscored — date filtering happens in App.
  if (plan.expandedTokens.length === 0 && plan.phrases.length === 0)
    return pool;

  const eventMap = new Map(pool.map((e) => [e.id, e]));
  const scored: Array<{ event: CalEvent; score: number }> = [];
  const scoredIds = new Set<string>();

  const eventByPos = (pos: number): CalEvent | undefined => {
    const id = index?.ids[pos];
    return id ? eventMap.get(id) : undefined;
  };

  // Phase 1: inverted index
  if (index && plan.expandedTokens.length > 0) {
    const candidatePos = new Set<number>();
    for (const token of plan.expandedTokens) {
      for (const pos of index.t[token] ?? []) candidatePos.add(pos);
      for (const pos of index.g[token] ?? []) candidatePos.add(pos);
      for (const pos of index.o[token] ?? []) candidatePos.add(pos);
      for (const pos of index.l[token] ?? []) candidatePos.add(pos);
      for (const pos of index.d[token] ?? []) candidatePos.add(pos);
    }
    for (const pos of candidatePos) {
      const ev = eventByPos(pos);
      if (!ev) continue;
      const score = scoreEvent(pos, plan, index, eventByPos);
      if (score > 0) {
        scored.push({ event: ev, score });
        scoredIds.add(ev.id);
      }
    }
  }

  // Phase 2: Fuse.js fallback for tokens with zero index hits
  const tokensWithHits = index
    ? new Set(
        plan.expandedTokens.filter(
          (t) =>
            (index.t[t]?.length ?? 0) > 0 ||
            (index.g[t]?.length ?? 0) > 0 ||
            (index.o[t]?.length ?? 0) > 0 ||
            (index.l[t]?.length ?? 0) > 0 ||
            (index.d[t]?.length ?? 0) > 0,
        ),
      )
    : new Set<string>();

  const fuzzyTokens = plan.keywords.filter((t) => !tokensWithHits.has(t));

  if (fuzzyTokens.length > 0 || scored.length === 0) {
    const fuzzyPool =
      scored.length === 0 ? pool : pool.filter((e) => !scoredIds.has(e.id));
    const fuse = new Fuse(fuzzyPool, {
      keys: [
        { name: "title", weight: 4 },
        { name: "tags", weight: 3 },
        { name: "organizer", weight: 2 },
        { name: "description", weight: 1 },
      ],
      threshold: 0.38,
      includeScore: true,
      minMatchCharLength: 2,
    });
    const fuseQuery = fuzzyTokens.length > 0 ? fuzzyTokens.join(" ") : plan.raw;
    for (const { item, score: fs } of fuse.search(fuseQuery, { limit: 100 })) {
      const relevance =
        Math.round((1 - (fs ?? 1)) * 40) + recencyBonus(item.date);
      const existing = scored.find((r) => r.event.id === item.id);
      if (existing) {
        existing.score += relevance;
      } else {
        scored.push({ event: item, score: relevance });
      }
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map((r) => r.event);
}

// ─── Main search function ─────────────────────────────────────────────────────

export interface SearchOutput {
  results: CalEvent[];
  plan: SearchPlan;
  fallbackUsed: boolean;
  fallbackMessage?: string;
}

export function searchEvents(
  events: CalEvent[],
  query: string,
  index: SearchIndex | null,
  dismissedKeys: Set<string> = new Set(),
): SearchOutput {
  if (!query.trim()) {
    return { results: events, plan: buildSearchPlan(""), fallbackUsed: false };
  }

  const plan = buildSearchPlan(query);

  // Remove dismissed interpretations from plan filters
  for (const key of dismissedKeys) {
    const [field] = key.split(":");
    if (field === "dateRange") delete plan.filters.dateRange;
    if (field === "category") delete plan.filters.category;
    if (field === "campusArea") delete plan.filters.campusArea;
    if (field === "timeOfDay") delete plan.filters.timeOfDay;
    if (field === "free") delete plan.filters.free;
    if (field === "modality") delete plan.filters.modality;
  }
  plan.interpretations = plan.interpretations.filter(
    (i) => !dismissedKeys.has(i.key),
  );

  // Apply plan-level hard filters (timeOfDay, free, modality)
  const pool = applyPoolFilters(events, plan, dismissedKeys);

  if (!index && plan.expandedTokens.length === 0) {
    return { results: pool, plan, fallbackUsed: false };
  }

  const results = runScoring(pool, plan, index);

  // Fallback: fewer than 3 strong results → broaden and explain
  if (results.length < 3) {
    // Try broadening date range
    if (plan.filters.dateRange && plan.filters.dateRange !== "upcoming") {
      const relaxedPlan: SearchPlan = {
        ...plan,
        filters: {
          ...plan.filters,
          dateRange:
            plan.filters.dateRange === "today" ||
            plan.filters.dateRange === "tomorrow"
              ? "week"
              : "upcoming",
        },
      };
      const fallbackPool = applyPoolFilters(events, relaxedPlan, dismissedKeys);
      const fallbackResults = runScoring(fallbackPool, relaxedPlan, index);
      if (fallbackResults.length >= 3) {
        const rangeLabel =
          plan.filters.dateRange === "today"
            ? "today"
            : plan.filters.dateRange === "tomorrow"
              ? "tomorrow"
              : "this week";
        return {
          results: fallbackResults,
          plan: relaxedPlan,
          fallbackUsed: true,
          fallbackMessage: `No matches for "${plan.keywords.join(" ")}" ${rangeLabel}. Showing upcoming results instead.`,
        };
      }
    }
    // Try dropping category
    if (plan.filters.category) {
      const cat = plan.filters.category;
      const relaxedPlan: SearchPlan = { ...plan, filters: { ...plan.filters } };
      delete relaxedPlan.filters.category;
      const fallbackPool = applyPoolFilters(events, relaxedPlan, dismissedKeys);
      const fallbackResults = runScoring(fallbackPool, relaxedPlan, index);
      if (fallbackResults.length > 0) {
        return {
          results: fallbackResults,
          plan,
          fallbackUsed: true,
          fallbackMessage: `No "${cat}" results for "${plan.keywords.join(" ")}". Showing all categories.`,
        };
      }
    }
  }

  return { results, plan, fallbackUsed: false };
}

// ─── Legacy exports ───────────────────────────────────────────────────────────

export { stem, tokenize };

/** @deprecated Use buildSearchPlan instead */
export function parseQuery(query: string) {
  const plan = buildSearchPlan(query);
  return {
    raw: plan.raw,
    cleaned: plan.cleaned,
    tokens: plan.keywords,
    intents: {
      dateRange: plan.filters.dateRange,
      category: plan.filters.category,
    },
  };
}

export function expandTokens(query: string): string[] {
  return buildSearchPlan(query).expandedTokens;
}
