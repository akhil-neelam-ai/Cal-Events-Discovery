import { TOPICS } from "../scripts/lib/topics";
import { BERKELEY_VENUE_ALIASES, DOMAIN_SYNONYMS, tokenize } from "./textUtils";

export interface SearchTopicDefinition {
  slug: string;
  label: string;
  synonyms: readonly string[];
}

export interface SearchFilter {
  dateRange?: "today" | "tomorrow" | "week" | "upcoming";
  weekend?: boolean;
  timeOfDay?: "morning" | "afternoon" | "evening";
  category?: string;
  source?: string;
  campusArea?: "northside" | "southside" | "downtown";
  free?: boolean;
  modality?: "online" | "in-person";
  topic?: string;
}

export interface InterpretedChip {
  key: string;
  label: string;
}

export interface SearchPlan {
  raw: string;
  cleaned: string;
  keywords: string[];
  expandedTokens: string[];
  phrases: string[];
  filters: SearchFilter;
  interpretations: InterpretedChip[];
}

export interface BuildSearchPlanOptions {
  topics?: readonly SearchTopicDefinition[];
}

const RE_TONIGHT = /\b(tonight|this evening)\b/i;
const RE_TODAY = /\b(today|this afternoon|this morning)\b/i;
const RE_TOMORROW = /\b(tomorrow|tmrw|tmr)\b/i;
const RE_WEEKEND = /\b(this weekend|weekend)\b/i;
const RE_WEEK = /\b(this week|next 7 days)\b/i;
const RE_UPCOMING = /\b(upcoming|next month|coming up|soon)\b/i;

const RE_MORNING = /\b(this morning|morning|breakfast|early morning)\b/i;
const RE_AFTERNOON_CLOCK =
  /\b(this afternoon|afternoon|midday|after class|after lunch|noon)\b/i;
const RE_LUNCH = /\blunch\b/i;
const RE_EVENING =
  /\b(tonight|this evening|evening|after work|after 5|nighttime|night)\b/i;

const RE_FREE =
  /(?:\bfree\s+(?:admission|entry|event|events|food|lunch|dinner|pizza|snacks|refreshments|ticket|tickets|screening|workshop|concert)\b|\bcomplimentary\b|\bno[-\s]?charge\b|\bno[-\s]?cost\b|\$0\b)/i;
const RE_CONTEXTUAL_FREE = /\bfree\s+(?:throw|agent|range|radical|speech)\b/i;
export const RE_FREE_EVENT =
  /(?:\bfree\b(?!\s*(?:throw|agent|range|radical|speech|will))|\bcomplimentary\b|\bno[-\s]?charge\b|\bno[-\s]?cost\b|\$0\b)/i;
const RE_ONLINE = /\b(online|virtual|zoom|remote|webinar|livestream)\b/i;
const RE_INPERSON = /\b(in.?person|on campus)\b/i;
const RE_CAL_GAMES = /\b(cal games?|bears games?|cal bears games?)\b/i;
const RE_BARE_FREE = /\bfree\b/i;

const CATEGORY_PATTERNS: Array<[string, RegExp]> = [
  [
    "Entrepreneurship",
    /\b(skydeck|entrepreneurship|product management|innovation hub)\b/i,
  ],
  [
    "Sports",
    /\b(cal games?|bears games?|cal bears|athletics|basketball|football|baseball|volleyball|soccer|swim meet|swim team|tennis|gymnastics|rowing|crew|sports)\b/i,
  ],
  ["Arts", /\b(arts?|performance|gallery|bampfa|exhibit)\b/i],
  [
    "Science & Tech",
    /\b((?<!data )(?<!computer )science(?:\s*&\s*tech)?|tech(?:nology)?|hackathon|coding|engineering talk|tech talk)\b/i,
  ],
  [
    "Student Life",
    /\b(student life|student org|orientation|undergrad|grad student|tabling|open house|coffee chat)\b/i,
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
  [
    "ai_risk",
    /\b(berkeley ai risk|ai-risk\.berkeley|ai risk speaker)\b/i,
    "Berkeley AI Risk",
  ],
  [
    "brsl",
    /\b(brsl|berkeley risk and security|berkeley risk & security)\b/i,
    "Berkeley Risk and Security Lab",
  ],
  ["livewhale", /\b(livewhale|uc berkeley events)\b/i, "UC Berkeley Events"],
];

export const AREA_PATTERNS: Array<
  [SearchFilter["campusArea"], RegExp, string]
> = [
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

export function topicPattern(synonym: string): RegExp {
  const escaped = synonym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i");
}

interface TopicSpan {
  topic: SearchTopicDefinition;
  synonym: string;
  index: number;
  length: number;
}

function collectTopicSpans(
  text: string,
  topics: readonly SearchTopicDefinition[],
): TopicSpan[] {
  const spans: TopicSpan[] = [];
  for (const topic of topics) {
    const synonyms = [...topic.synonyms].sort(
      (left, right) => right.length - left.length,
    );
    for (const synonym of synonyms) {
      const pattern = new RegExp(topicPattern(synonym).source, "gi");
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        spans.push({
          topic,
          synonym,
          index: match.index,
          length: match[0].length,
        });
      }
    }
  }

  spans.sort(
    (left, right) => left.index - right.index || right.length - left.length,
  );
  const nonOverlapping: TopicSpan[] = [];
  let cursor = -1;
  for (const span of spans) {
    if (span.index < cursor) continue;
    nonOverlapping.push(span);
    cursor = span.index + span.length;
  }
  return nonOverlapping;
}

function maskSpans(text: string, spans: readonly TopicSpan[]): string {
  let masked = text;
  for (const span of [...spans].sort(
    (left, right) => right.index - left.index,
  )) {
    masked =
      masked.slice(0, span.index) +
      " ".repeat(span.length) +
      masked.slice(span.index + span.length);
  }
  return masked;
}

export function expandKeywordTokens(
  keywords: string[],
  rawLower: string,
): string[] {
  const expandedSet = new Set<string>(keywords);

  for (const [phrase, syns] of Object.entries(DOMAIN_SYNONYMS)) {
    if (phrase.includes(" ") && rawLower.includes(phrase)) {
      for (const synonym of syns)
        tokenize(synonym).forEach((token) => expandedSet.add(token));
    }
  }
  for (const keyword of keywords) {
    const syns =
      DOMAIN_SYNONYMS[keyword] ?? STEMMED_DOMAIN_SYNONYMS.get(keyword);
    if (syns) {
      for (const synonym of syns)
        tokenize(synonym).forEach((token) => expandedSet.add(token));
    }
  }
  for (const [alias, expansion] of Object.entries(BERKELEY_VENUE_ALIASES)) {
    if (rawLower.includes(alias)) {
      tokenize(expansion).forEach((token) => expandedSet.add(token));
    }
  }

  return Array.from(expandedSet);
}

export function resolvePlanTopics(
  topics?: readonly SearchTopicDefinition[],
): readonly SearchTopicDefinition[] {
  return topics ?? TOPICS;
}

export function dismissedKeysForExplicitTopic(
  plan: SearchPlan | null,
  explicitTopic: string | null | undefined,
  extra: Iterable<string> = [],
): Set<string> {
  const keys = new Set(extra);
  const inferred = plan?.filters.topic;
  if (explicitTopic && inferred && inferred !== explicitTopic) {
    keys.add(`topic:${inferred}`);
  }
  return keys;
}

export function buildSearchPlan(
  query: string,
  options: BuildSearchPlanOptions = {},
): SearchPlan {
  const topics = resolvePlanTopics(options.topics);
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

  for (const [source, pattern, label] of SOURCE_PATTERNS) {
    if (pattern.test(cleaned)) {
      filters.source = source;
      interpretations.push({ key: `source:${source}`, label });
      cleaned = stripIntent(cleaned, pattern);
      break;
    }
  }

  const topicSpans = collectTopicSpans(cleaned, topics);
  const firstTopic = topicSpans[0] ?? null;
  if (firstTopic) {
    filters.topic = firstTopic.topic.slug;
    interpretations.push({
      key: `topic:${firstTopic.topic.slug}`,
      label: firstTopic.topic.label,
    });
    cleaned = stripIntent(cleaned, topicPattern(firstTopic.synonym));
  }

  const remainingSpans = collectTopicSpans(cleaned, topics);
  const detectorText = maskSpans(cleaned, remainingSpans);

  if (RE_MORNING.test(raw)) {
    filters.timeOfDay = "morning";
    addInterpretationOnce(interpretations, {
      key: "timeOfDay:morning",
      label: "Morning",
    });
    cleaned = stripIntent(cleaned, RE_MORNING);
  } else if (RE_AFTERNOON_CLOCK.test(raw) || RE_LUNCH.test(detectorText)) {
    filters.timeOfDay = "afternoon";
    addInterpretationOnce(interpretations, {
      key: "timeOfDay:afternoon",
      label: "Afternoon",
    });
    cleaned = stripIntent(cleaned, RE_AFTERNOON_CLOCK);
    cleaned = stripIntent(cleaned, RE_LUNCH);
  } else if (RE_EVENING.test(raw) && !filters.timeOfDay) {
    filters.timeOfDay = "evening";
    addInterpretationOnce(interpretations, {
      key: "timeOfDay:evening",
      label: "Evening",
    });
    cleaned = stripIntent(cleaned, RE_EVENING);
  }

  if (RE_ONLINE.test(detectorText)) {
    filters.modality = "online";
    interpretations.push({ key: "modality:online", label: "Online" });
    cleaned = stripIntent(cleaned, RE_ONLINE);
  } else if (RE_INPERSON.test(detectorText)) {
    filters.modality = "in-person";
    interpretations.push({ key: "modality:in-person", label: "In Person" });
    cleaned = stripIntent(cleaned, RE_INPERSON);
  }

  if (RE_CONTEXTUAL_FREE.test(raw)) {
    cleaned = stripIntent(cleaned, /\bfree\b/i);
  } else if (RE_FREE.test(detectorText)) {
    filters.free = true;
    interpretations.push({ key: "free:true", label: "Free" });
  } else if (
    firstTopic &&
    RE_BARE_FREE.test(detectorText) &&
    !/\bfree will\b/i.test(raw)
  ) {
    filters.free = true;
    interpretations.push({ key: "free:true", label: "Free" });
  }

  for (const [category, pattern] of CATEGORY_PATTERNS) {
    if (pattern.test(detectorText)) {
      filters.category = category;
      interpretations.push({ key: `category:${category}`, label: category });
      cleaned = stripIntent(cleaned, pattern);
      break;
    }
  }

  if (RE_CAL_GAMES.test(raw)) {
    cleaned = stripIntent(cleaned, RE_CAL_GAMES);
  }

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

  const cleanedLower = cleaned.toLowerCase();
  for (const phrase of KNOWN_PHRASES) {
    if (cleanedLower.includes(phrase)) phrases.push(phrase);
  }

  const keywords = tokenize(
    cleaned || (interpretations.length === 0 ? raw : ""),
  );
  const expandedTokens = expandKeywordTokens(keywords, cleanedLower);

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

export function withDismissedInterpretations(
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
    if (field === "topic") delete filters.topic;
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

  const dismissedTopicText = plan.interpretations
    .filter(
      (interpretation) =>
        dismissedKeys.has(interpretation.key) &&
        interpretation.key.startsWith("topic:"),
    )
    .map((interpretation) => interpretation.label)
    .join(" ");
  if (dismissedTopicText) {
    cleaned = [cleaned, dismissedTopicText].filter(Boolean).join(" ");
    keywords = tokenize(cleaned);
    expandedTokens = expandKeywordTokens(
      keywords,
      `${plan.raw} ${dismissedTopicText}`.toLowerCase(),
    );
  }

  return {
    ...plan,
    cleaned,
    keywords,
    expandedTokens,
    filters,
    interpretations: plan.interpretations.filter(
      (item) => !dismissedKeys.has(item.key),
    ),
  };
}
