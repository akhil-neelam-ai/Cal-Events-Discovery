import Fuse from "fuse.js";
import type { CalEvent } from "../types";
import {
  tokenize,
  stem,
  DOMAIN_SYNONYMS,
  BERKELEY_VENUE_ALIASES,
} from "./textUtils";
import {
  addDaysToDateKey,
  getCurrentPacificDateKey,
  getPacificDateKey,
} from "./eventDates";
import type { SearchIndex } from "./textUtils";

export type { SearchIndex };

// ─── SearchPlan ───────────────────────────────────────────────────────────────

export interface SearchFilter {
  dateRange?: "today" | "tomorrow" | "week" | "upcoming";
  weekend?: boolean;
  timeOfDay?: "morning" | "afternoon" | "evening";
  category?: string;
  source?: string;
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

const RE_TONIGHT = /\b(tonight|this evening)\b/i;
const RE_TODAY = /\b(today|this afternoon|this morning)\b/i;
const RE_TOMORROW = /\b(tomorrow|tmrw|tmr)\b/i;
const RE_WEEKEND = /\b(this weekend|weekend)\b/i;
const RE_WEEK = /\b(this week|next 7 days)\b/i;
const RE_UPCOMING = /\b(upcoming|next month|coming up|soon)\b/i;

const RE_MORNING = /\b(this morning|morning|breakfast|early morning)\b/i;
const RE_AFTERNOON =
  /\b(this afternoon|afternoon|lunch|midday|after class|after lunch|noon)\b/i;
const RE_EVENING =
  /\b(tonight|this evening|evening|after work|after 5|nighttime|night)\b/i;

const RE_FREE =
  /(?:\bfree\s+(?:admission|entry|event|events|food|lunch|dinner|pizza|snacks|refreshments|ticket|tickets|screening|workshop|concert)\b|\bcomplimentary\b|\bno[-\s]?charge\b|\bno[-\s]?cost\b|\$0\b)/i;
const RE_CONTEXTUAL_FREE = /\bfree\s+(?:throw|agent|range|radical|speech)\b/i;
const RE_FREE_EVENT =
  /(?:\bfree\b(?!\s*(?:throw|agent|range|radical|speech|will))|\bcomplimentary\b|\bno[-\s]?charge\b|\bno[-\s]?cost\b|\$0\b)/i;
const RE_ONLINE = /\b(online|virtual|zoom|remote|webinar|livestream)\b/i;
const RE_INPERSON = /\b(in.?person|on campus)\b/i;
const RE_CAL_GAMES = /\b(cal games?|bears games?|cal bears games?)\b/i;

// Category patterns — first match wins
const CATEGORY_PATTERNS: Array<[string, RegExp]> = [
  [
    "Entrepreneurship",
    /\b(startup|founder|venture|pitch|demo day|skydeck|entrepreneur|entrepreneurship|product management|innovation hub)\b/i,
  ],
  [
    "Sports",
    /\b(cal games?|bears games?|cal bears|athletics|basketball|football|baseball|volleyball|soccer|swim meet|swim team|tennis|gymnastics|rowing|crew|sports)\b/i,
  ],
  [
    "Arts",
    /\b(arts?|film screening|film|movie|concert|performance|theater|theatre|gallery|bampfa|dance|opera|recital|exhibition|exhibit|museum|poetry)\b/i,
  ],
  [
    "Science & Tech",
    /\b(science(?:\s*&\s*tech)?|tech(?:nology)?|ai\b|artificial intelligence|machine learning|language models?|llm|data science|hackathon|coding|computer science|eecs|engineering talk|robotics|biotech|genomics|tech talk)\b/i,
  ],
  [
    "Student Life",
    /\b(student life|free food|student org|club|social|mixer|orientation|undergrad|grad student|tabling|info session|open house|coffee chat)\b/i,
  ],
  [
    "Academic",
    /\b(academic|seminar|colloquium|lecture|symposium|dissertation defense|dissertation|thesis defense|guest speaker|research talk|keynote)\b/i,
  ],
];

const SOURCE_PATTERNS: Array<[string, RegExp, string]> = [
  [
    "bampfa",
    /\b(bampfa|berkeley art museum|pacific film archive)\b/i,
    "BAMPFA",
  ],
  ["calbears", /\b(cal bears|cal athletics|calbears)\b/i, "Cal Bears"],
  ["cal_performances", /\b(cal performances)\b/i, "Cal Performances"],
  ["callink", /\b(callink|cal link)\b/i, "CalLink"],
  ["haas", /\b(haas|berkeley haas|business school)\b/i, "Berkeley Haas"],
  ["berkeley_law", /\b(berkeley law|law school|bclt)\b/i, "Berkeley Law"],
  ["simons", /\b(simons|simons institute)\b/i, "Simons Institute"],
  ["livewhale", /\b(livewhale|uc berkeley events)\b/i, "UC Berkeley Events"],
  [
    "ehub",
    /\b(e-?hub|entrepreneurship hub|berkeley e-?hub)\b/i,
    "Berkeley E-Hub",
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

function stripIntent(text: string, pattern: RegExp): string {
  return text.replace(pattern, " ").replace(/\s+/g, " ").trim();
}

function addInterpretationOnce(
  interpretations: InterpretedChip[],
  next: InterpretedChip,
): void {
  if (!interpretations.some((item) => item.key === next.key)) {
    interpretations.push(next);
  }
}

const STEMMED_DOMAIN_SYNONYMS = new Map<string, string[]>();

for (const [key, synonyms] of Object.entries(DOMAIN_SYNONYMS)) {
  if (key.includes(" ")) {
    continue;
  }

  for (const token of tokenize(key)) {
    STEMMED_DOMAIN_SYNONYMS.set(token, [
      ...(STEMMED_DOMAIN_SYNONYMS.get(token) ?? []),
      ...synonyms,
    ]);
  }
}

function expandKeywordTokens(keywords: string[], rawLower: string): string[] {
  const expandedSet = new Set<string>(keywords);

  // Multi-word synonyms (e.g. "free food")
  for (const [phrase, syns] of Object.entries(DOMAIN_SYNONYMS)) {
    if (phrase.includes(" ") && rawLower.includes(phrase)) {
      for (const s of syns) tokenize(s).forEach((t) => expandedSet.add(t));
    }
  }
  // Single-word synonyms
  for (const kw of keywords) {
    const syns = DOMAIN_SYNONYMS[kw] ?? STEMMED_DOMAIN_SYNONYMS.get(kw);
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

  return Array.from(expandedSet);
}

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
  if (RE_TONIGHT.test(raw)) {
    filters.dateRange = "today";
    filters.timeOfDay = "evening";
    interpretations.push({ key: "dateRange:today", label: "Today" });
    interpretations.push({ key: "timeOfDay:evening", label: "Evening" });
    cleaned = stripIntent(cleaned, RE_TONIGHT);
  } else if (RE_TODAY.test(raw)) {
    filters.dateRange = "today";
    interpretations.push({ key: "dateRange:today", label: "Today" });
    cleaned = stripIntent(cleaned, RE_TODAY);
  } else if (RE_TOMORROW.test(raw)) {
    filters.dateRange = "tomorrow";
    interpretations.push({ key: "dateRange:tomorrow", label: "Tomorrow" });
    cleaned = stripIntent(cleaned, RE_TOMORROW);
  } else if (RE_WEEKEND.test(raw)) {
    filters.dateRange = "week";
    filters.weekend = true;
    interpretations.push({ key: "dateRange:week", label: "This Week" });
    interpretations.push({ key: "weekend:true", label: "This Weekend" });
    cleaned = stripIntent(cleaned, RE_WEEKEND);
  } else if (RE_WEEK.test(raw)) {
    filters.dateRange = "week";
    interpretations.push({ key: "dateRange:week", label: "This Week" });
    cleaned = stripIntent(cleaned, RE_WEEK);
  } else if (RE_UPCOMING.test(raw)) {
    filters.dateRange = "upcoming";
    interpretations.push({ key: "dateRange:upcoming", label: "Upcoming" });
    cleaned = stripIntent(cleaned, RE_UPCOMING);
  }

  // ── Time of day ───────────────────────────────────────────────────────────
  if (RE_MORNING.test(raw)) {
    filters.timeOfDay = "morning";
    addInterpretationOnce(interpretations, {
      key: "timeOfDay:morning",
      label: "Morning",
    });
    cleaned = stripIntent(cleaned, RE_MORNING);
  } else if (RE_AFTERNOON.test(raw)) {
    filters.timeOfDay = "afternoon";
    addInterpretationOnce(interpretations, {
      key: "timeOfDay:afternoon",
      label: "Afternoon",
    });
    cleaned = stripIntent(cleaned, RE_AFTERNOON);
  } else if (RE_EVENING.test(raw)) {
    filters.timeOfDay = "evening";
    addInterpretationOnce(interpretations, {
      key: "timeOfDay:evening",
      label: "Evening",
    });
    cleaned = stripIntent(cleaned, RE_EVENING);
  }

  // ── Modality ──────────────────────────────────────────────────────────────
  if (RE_ONLINE.test(raw)) {
    filters.modality = "online";
    interpretations.push({ key: "modality:online", label: "Online" });
    cleaned = stripIntent(cleaned, RE_ONLINE);
  } else if (RE_INPERSON.test(raw)) {
    filters.modality = "in-person";
    interpretations.push({ key: "modality:in-person", label: "In Person" });
    cleaned = stripIntent(cleaned, RE_INPERSON);
  }

  // ── Free ──────────────────────────────────────────────────────────────────
  if (RE_FREE.test(raw)) {
    filters.free = true;
    interpretations.push({ key: "free:true", label: "Free" });
  } else if (RE_CONTEXTUAL_FREE.test(raw)) {
    cleaned = stripIntent(cleaned, /\bfree\b/i);
  }

  // ── Source ────────────────────────────────────────────────────────────────
  for (const [source, pattern, label] of SOURCE_PATTERNS) {
    if (pattern.test(raw)) {
      filters.source = source;
      interpretations.push({ key: `source:${source}`, label });
      cleaned = stripIntent(cleaned, pattern);
      break;
    }
  }

  // ── Category ─────────────────────────────────────────────────────────────
  for (const [category, pattern] of CATEGORY_PATTERNS) {
    if (pattern.test(raw)) {
      filters.category = category;
      interpretations.push({ key: `category:${category}`, label: category });
      break;
    }
  }

  if (RE_CAL_GAMES.test(raw)) {
    cleaned = stripIntent(cleaned, RE_CAL_GAMES);
  }

  // ── Campus area ───────────────────────────────────────────────────────────
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
      cleaned = stripIntent(cleaned, pattern);
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

  const expandedTokens = expandKeywordTokens(keywords, rawLower);

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
  const time = new Date(dateStr).getTime();
  if (Number.isNaN(time)) return 0;
  const ms = time - Date.now();
  const days = ms / 86_400_000;
  if (days < 0 || days > 30) return 0;
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

function eventHasAnyExpandedToken(ev: CalEvent, plan: SearchPlan): boolean {
  if (plan.expandedTokens.length === 0) {
    return true;
  }

  const tokens = new Set(
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

  return plan.expandedTokens.some((token) => tokens.has(token));
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
  const coreMatched = new Set<string>();
  const aiSemanticIntent = hasAiSemanticIntent(plan);

  // Exact raw and known-phrase matches should count even before token scoring.
  const boostedPhraseScore = phraseBoost(ev, plan);
  if (boostedPhraseScore > 0) matched++;
  score += boostedPhraseScore;

  // Field-weighted token scoring
  for (const qt of plan.expandedTokens) {
    const isCore = plan.keywords.includes(qt);
    const mult =
      (isCore ? W.coreMultiplier : W.synMultiplier) *
      tokenFrequencyMultiplier(qt, index);

    const markMatched = () => {
      matched++;
      if (isCore) coreMatched.add(qt);
      if (aiSemanticIntent && AI_SEMANTIC_TOKENS.has(qt)) {
        coreMatched.add("__ai_semantic__");
      }
    };

    if (index.t[qt]?.includes(pos)) {
      score += W.title * mult;
      markMatched();
    }
    if (index.g[qt]?.includes(pos)) {
      score += W.tag * mult;
      markMatched();
    }
    if (index.o[qt]?.includes(pos)) {
      score += W.org * mult;
      markMatched();
    }
    if (index.l[qt]?.includes(pos)) {
      score += W.location * mult;
      markMatched();
    }
    if (index.d[qt]?.includes(pos)) {
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
      if (hour === null) return false;
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
  const hasMissingStrictToken =
    Boolean(index) && fuzzyTokens.some((t) => STRICT_FUZZY_TOKENS.has(t));

  if (!hasMissingStrictToken && fuzzyTokens.length > 0) {
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

    for (const { query: fuseQuery, requireTokenMatch } of fuseQueries) {
      for (const { item, score: fs } of fuse.search(fuseQuery, {
        limit: 100,
      })) {
        if (requireTokenMatch && !eventHasAnyExpandedToken(item, plan)) {
          continue;
        }

        const relevance =
          Math.round((1 - (fs ?? 1)) * 40) +
          phraseBoost(item, plan) +
          recencyBonus(item.date);
        const existing = scored.find((r) => r.event.id === item.id);
        if (existing) {
          existing.score += relevance;
        } else {
          scored.push({ event: item, score: relevance });
        }
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

function withDismissedInterpretations(
  plan: SearchPlan,
  dismissedKeys: Set<string>,
): SearchPlan {
  const filters: SearchFilter = { ...plan.filters };
  let cleaned = plan.cleaned;
  let keywords = plan.keywords;
  let expandedTokens = plan.expandedTokens;

  for (const key of dismissedKeys) {
    const [field] = key.split(":");
    if (field === "dateRange") delete filters.dateRange;
    if (field === "weekend") delete filters.weekend;
    if (field === "category") delete filters.category;
    if (field === "source") delete filters.source;
    if (field === "campusArea") delete filters.campusArea;
    if (field === "timeOfDay") delete filters.timeOfDay;
    if (field === "free") delete filters.free;
    if (field === "modality") delete filters.modality;
  }

  const dismissedLiteralText = plan.interpretations
    .filter(
      (interpretation) =>
        dismissedKeys.has(interpretation.key) &&
        (interpretation.key.startsWith("source:") ||
          interpretation.key.startsWith("category:")),
    )
    .map((interpretation) => interpretation.label)
    .join(" ");

  if (keywords.length === 0 && dismissedLiteralText) {
    cleaned = dismissedLiteralText;
    keywords = tokenize(cleaned);
    expandedTokens = expandKeywordTokens(
      keywords,
      `${plan.raw} ${dismissedLiteralText}`.toLowerCase(),
    );
  }

  return {
    ...plan,
    cleaned,
    keywords,
    expandedTokens,
    filters,
    interpretations: plan.interpretations.filter(
      (i) => !dismissedKeys.has(i.key),
    ),
  };
}

export function searchEvents(
  events: CalEvent[],
  query: string,
  index: SearchIndex | null,
  dismissedKeys: Set<string> = new Set(),
): SearchOutput {
  if (!query.trim()) {
    return {
      results: events,
      plan: buildSearchPlan(""),
      fallbackUsed: false,
      fallbackMessage: undefined,
    };
  }

  const plan = withDismissedInterpretations(
    buildSearchPlan(query),
    dismissedKeys,
  );

  // Apply plan-level hard filters before relevance scoring.
  const pool = applyPoolFilters(events, plan, dismissedKeys);

  if (!index && plan.expandedTokens.length === 0) {
    return { results: pool, plan, fallbackUsed: false };
  }

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
