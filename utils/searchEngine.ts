import Fuse from "fuse.js";
import type { CalEvent } from "../types";
import { tokenize, stem } from "./textUtils";
import {
  addDaysToDateKey,
  daysBetweenDateKeys,
  getCurrentPacificDateKey,
  getPacificDateKey,
  sortEventsChronologically,
} from "./eventDates";
import type { SearchIndex } from "./textUtils";
import {
  AREA_PATTERNS,
  buildSearchPlan,
  RE_FREE_EVENT,
  resolvePlanTopics,
  withDismissedInterpretations,
  type BuildSearchPlanOptions,
  type SearchPlan,
} from "./searchIntent";

export type { SearchIndex };
export type {
  BuildSearchPlanOptions,
  InterpretedChip,
  SearchFilter,
  SearchPlan,
  SearchTopicDefinition,
} from "./searchIntent";
export {
  buildSearchPlan,
  dismissedKeysForExplicitTopic,
  resolvePlanTopics,
} from "./searchIntent";

const STRICT_FUZZY_TOKENS = new Set([
  "basketball",
  "football",
  "baseball",
  "volleyball",
  "soccer",
  "tennis",
  "gymnastic",
  "rowing",
  "hackathon",
  "moffitt",
  "bampfa",
  "haas",
  "simons",
  "eecs",
  "cdss",
]);

const AI_SEMANTIC_TOKENS = new Set([
  "ai",
  "artificial",
  "intelligence",
  "machine",
  "learn",
  "language",
  "model",
  "llm",
]);

function hasAiSemanticIntent(plan: SearchPlan): boolean {
  return /\b(ai|artificial intelligence|machine learning|language models?|llm)\b/i.test(
    plan.raw,
  );
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
  const eventKey = getPacificDateKey(dateStr);
  if (!eventKey) return 0;
  const days = daysBetweenDateKeys(getCurrentPacificDateKey(), eventKey);
  if (days === null || days < 0 || days > 30) return 0;
  return Math.round(W.recency * (1 - days / 30));
}

function parseHour(timeStr: string): number | null {
  const m = timeStr.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (!m) return null;
  if (m[2] && Number(m[2]) > 59) return null;
  let h = parseInt(m[1], 10);
  if (h < 1 || h > 12) return null;
  if (m[3].toLowerCase() === "pm" && h !== 12) h += 12;
  if (m[3].toLowerCase() === "am" && h === 12) h = 0;
  return h;
}

function currentWeekendKeys(): Set<string> {
  const todayKey = getCurrentPacificDateKey();
  const [, , day] = todayKey.split("-").map(Number);
  const date = new Date(`${todayKey}T00:00:00Z`);
  const weekday = date.getUTCDay();
  const saturdayOffset = weekday === 0 ? -1 : (6 - weekday + 7) % 7;
  const saturday = addDaysToDateKey(todayKey, saturdayOffset);
  const sunday = addDaysToDateKey(saturday, 1);

  if (!day) return new Set();
  return new Set([saturday, sunday]);
}

function tokenFrequencyMultiplier(token: string, index: SearchIndex): number {
  const positions = new Set<number>();
  for (const field of [index.t, index.g, index.o, index.l, index.d]) {
    for (const pos of field[token] ?? []) positions.add(pos);
  }

  const ratio = positions.size / Math.max(index.eventCount, 1);
  if (ratio > 0.3) return 0.2;
  if (ratio > 0.15) return 0.4;
  if (ratio > 0.08) return 0.65;
  if (ratio < 0.01) return 1.15;
  return 1;
}

function requiredCoreMatches(plan: SearchPlan): number {
  const coreCount = new Set(plan.keywords).size;
  if (coreCount <= 1) return coreCount;
  if (hasAiSemanticIntent(plan) && !plan.keywords.includes("talk")) {
    return 1;
  }
  return Math.min(2, coreCount);
}

function phraseBoost(ev: CalEvent, plan: SearchPlan): number {
  let score = 0;
  const titleLower = ev.title.toLowerCase();

  if (plan.raw && titleLower.includes(plan.raw.toLowerCase())) {
    score += W.titlePhrase;
  }

  if (plan.phrases.length > 0) {
    const phraseText = `${ev.title} ${ev.description ?? ""}`.toLowerCase();
    for (const phrase of plan.phrases) {
      if (phraseText.includes(phrase)) {
        score += W.phraseMatch;
      }
    }
  }

  return score;
}

function tokenizeEvent(ev: CalEvent): Set<string> {
  return new Set(
    tokenize(
      [
        ev.title,
        ev.organizer ?? "",
        ev.description ?? "",
        ev.location ?? "",
        ...(ev.tags ?? []),
      ].join(" "),
    ),
  );
}

function eventHasAnyExpandedToken(
  ev: CalEvent,
  plan: SearchPlan,
  tokensFor: (e: CalEvent) => Set<string>,
): boolean {
  if (plan.expandedTokens.length === 0) {
    return true;
  }

  const tokens = tokensFor(ev);
  return plan.expandedTokens.some((token) => tokens.has(token));
}

/** Per-token posting-list membership sets, hoisted out of the candidate loop. */
interface TokenFieldSets {
  t: Set<number>;
  g: Set<number>;
  o: Set<number>;
  l: Set<number>;
  d: Set<number>;
}

function scoreEvent(
  pos: number,
  plan: SearchPlan,
  fieldSets: Map<string, TokenFieldSets>,
  multipliers: Map<string, number>,
  eventByPos: (p: number) => CalEvent | undefined,
): number {
  const ev = eventByPos(pos);
  if (!ev) return 0;

  let score = 0;
  let matched = 0;
  const coreMatched = new Set<string>();
  const aiSemanticIntent = hasAiSemanticIntent(plan);

  // Exact raw and known-phrase matches should count even before token scoring.
  const boostedPhraseScore = phraseBoost(ev, plan);
  if (boostedPhraseScore > 0) matched++;
  score += boostedPhraseScore;

  // Field-weighted token scoring
  for (const qt of plan.expandedTokens) {
    const sets = fieldSets.get(qt);
    if (!sets) continue;
    const isCore = plan.keywords.includes(qt);
    const mult =
      (isCore ? W.coreMultiplier : W.synMultiplier) *
      (multipliers.get(qt) ?? 1);

    const markMatched = () => {
      matched++;
      if (isCore) coreMatched.add(qt);
      if (aiSemanticIntent && AI_SEMANTIC_TOKENS.has(qt)) {
        coreMatched.add("__ai_semantic__");
      }
    };

    if (sets.t.has(pos)) {
      score += W.title * mult;
      markMatched();
    }
    if (sets.g.has(pos)) {
      score += W.tag * mult;
      markMatched();
    }
    if (sets.o.has(pos)) {
      score += W.org * mult;
      markMatched();
    }
    if (sets.l.has(pos)) {
      score += W.location * mult;
      markMatched();
    }
    if (sets.d.has(pos)) {
      score += W.desc * mult;
      markMatched();
    }
  }

  if (matched === 0) return 0;
  if (coreMatched.size < requiredCoreMatches(plan)) return 0;

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
  const weekendKeys =
    filters.weekend && !dismissedKeys.has("weekend:true")
      ? currentWeekendKeys()
      : null;

  return events.filter((ev) => {
    if (
      filters.source &&
      !dismissedKeys.has(`source:${filters.source}`) &&
      ev.source !== filters.source
    ) {
      return false;
    }

    if (
      filters.category &&
      !dismissedKeys.has(`category:${filters.category}`)
    ) {
      const primaryCategory = ev.tags?.[0] ?? "";
      if (primaryCategory.toLowerCase() !== filters.category.toLowerCase()) {
        return false;
      }
    }

    if (
      filters.topic &&
      !dismissedKeys.has(`topic:${filters.topic}`) &&
      !(ev.topics ?? []).includes(
        filters.topic as NonNullable<CalEvent["topics"]>[number],
      )
    ) {
      return false;
    }

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

    if (weekendKeys) {
      const eventDateKey = getPacificDateKey(ev.date);
      if (!eventDateKey || !weekendKeys.has(eventDateKey)) {
        return false;
      }
    }

    // Time-of-day: soft hard filter — only when explicitly detected
    if (
      filters.timeOfDay &&
      !dismissedKeys.has(`timeOfDay:${filters.timeOfDay}`)
    ) {
      const hour = ev.time ? parseHour(ev.time) : null;
      if (hour === null) return true;
      if (filters.timeOfDay === "morning" && hour >= 12) return false;
      if (filters.timeOfDay === "afternoon" && (hour < 12 || hour >= 17))
        return false;
      if (filters.timeOfDay === "evening" && hour < 17) return false;
    }
    // Free events
    if (filters.free && !dismissedKeys.has("free:true")) {
      const text = `${ev.title} ${ev.description ?? ""}`.toLowerCase();
      if (!RE_FREE_EVENT.test(text)) return false;
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
    return sortEventsChronologically(pool);

  const eventMap = new Map(pool.map((e) => [e.id, e]));
  const scored = new Map<string, { event: CalEvent; score: number }>();

  const eventByPos = (pos: number): CalEvent | undefined => {
    const id = index?.ids[pos];
    return id ? eventMap.get(id) : undefined;
  };

  // Phase 1: inverted index
  if (index && plan.expandedTokens.length > 0) {
    // Hoist per-token posting-list Sets and frequency multipliers out of the
    // candidate loop — both depend only on (token, index), never the candidate.
    const fieldSets = new Map<string, TokenFieldSets>();
    const multipliers = new Map<string, number>();
    for (const token of plan.expandedTokens) {
      fieldSets.set(token, {
        t: new Set(index.t[token] ?? []),
        g: new Set(index.g[token] ?? []),
        o: new Set(index.o[token] ?? []),
        l: new Set(index.l[token] ?? []),
        d: new Set(index.d[token] ?? []),
      });
      multipliers.set(token, tokenFrequencyMultiplier(token, index));
    }

    const candidatePos = new Set<number>();
    for (const sets of fieldSets.values()) {
      for (const pos of sets.t) candidatePos.add(pos);
      for (const pos of sets.g) candidatePos.add(pos);
      for (const pos of sets.o) candidatePos.add(pos);
      for (const pos of sets.l) candidatePos.add(pos);
      for (const pos of sets.d) candidatePos.add(pos);
    }
    for (const pos of candidatePos) {
      const ev = eventByPos(pos);
      if (!ev) continue;
      const score = scoreEvent(pos, plan, fieldSets, multipliers, eventByPos);
      if (score > 0) {
        scored.set(ev.id, { event: ev, score });
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
  const hasMissingStrictToken =
    Boolean(index) && fuzzyTokens.some((t) => STRICT_FUZZY_TOKENS.has(t));

  if (!hasMissingStrictToken && fuzzyTokens.length > 0) {
    const fuzzyPool =
      scored.size === 0 ? pool : pool.filter((e) => !scored.has(e.id));
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
    const fuseQueries: Array<{ query: string; requireTokenMatch: boolean }> =
      [];
    const seenFuseQueries = new Set<string>();
    const addFuseQuery = (query: string, requireTokenMatch: boolean) => {
      if (!query || seenFuseQueries.has(query)) return;
      seenFuseQueries.add(query);
      fuseQueries.push({ query, requireTokenMatch });
    };

    addFuseQuery(plan.cleaned, true);
    addFuseQuery(fuzzyTokens.length > 0 ? fuzzyTokens.join(" ") : "", false);
    addFuseQuery(plan.raw, true);

    // Memoize event tokenization so a candidate returned by multiple Fuse
    // queries is tokenized at most once across the fallback phase.
    const fuzzyTokenCache = new Map<string, Set<string>>();
    const tokensFor = (ev: CalEvent): Set<string> => {
      let tokens = fuzzyTokenCache.get(ev.id);
      if (!tokens) {
        tokens = tokenizeEvent(ev);
        fuzzyTokenCache.set(ev.id, tokens);
      }
      return tokens;
    };

    for (const { query: fuseQuery, requireTokenMatch } of fuseQueries) {
      for (const { item, score: fs } of fuse.search(fuseQuery, {
        limit: 100,
      })) {
        if (
          requireTokenMatch &&
          !eventHasAnyExpandedToken(item, plan, tokensFor)
        ) {
          continue;
        }

        const relevance =
          Math.round((1 - (fs ?? 1)) * 40) +
          phraseBoost(item, plan) +
          recencyBonus(item.date);
        const existing = scored.get(item.id);
        if (existing) {
          existing.score += relevance;
        } else {
          scored.set(item.id, { event: item, score: relevance });
        }
      }
    }
  }

  return [...scored.values()]
    .sort((a, b) => b.score - a.score)
    .map((r) => r.event);
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
  options: BuildSearchPlanOptions = {},
): SearchOutput {
  if (!query.trim()) {
    return {
      results: events,
      plan: buildSearchPlan("", options),
      fallbackUsed: false,
      fallbackMessage: undefined,
    };
  }

  const plan = withDismissedInterpretations(
    buildSearchPlan(query, options),
    dismissedKeys,
  );

  // Apply plan-level hard filters before relevance scoring.
  const pool = applyPoolFilters(events, plan, dismissedKeys);

  const results = runScoring(pool, plan, index);

  // Fallback: empty result sets can broaden and explain.
  if (results.length === 0) {
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
      if (plan.filters.weekend) {
        delete relaxedPlan.filters.weekend;
      }
      const fallbackPool = applyPoolFilters(events, relaxedPlan, dismissedKeys);
      const fallbackResults = runScoring(fallbackPool, relaxedPlan, index);
      if (fallbackResults.length > 0) {
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
    // Try dropping topic
    if (plan.filters.topic) {
      const topic = resolvePlanTopics(options.topics).find(
        (candidate) => candidate.slug === plan.filters.topic,
      );
      const relaxedPlan: SearchPlan = { ...plan, filters: { ...plan.filters } };
      delete relaxedPlan.filters.topic;
      const fallbackPool = applyPoolFilters(events, relaxedPlan, dismissedKeys);
      const fallbackResults = runScoring(fallbackPool, relaxedPlan, index);
      if (fallbackResults.length > 0) {
        return {
          results: fallbackResults,
          plan,
          fallbackUsed: true,
          fallbackMessage: `No "${topic?.label ?? plan.filters.topic}" results for "${plan.keywords.join(" ")}". Showing all topics.`,
        };
      }
    }
  }

  return { results, plan, fallbackUsed: false };
}

// ─── Legacy exports ───────────────────────────────────────────────────────────

export { stem, tokenize };
