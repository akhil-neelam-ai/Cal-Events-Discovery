import { TOPICS } from "../scripts/lib/topics";
import { DOMAIN_SYNONYMS, tokenize, venueAliasExpansions } from "./textUtils";

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

/** Where words sit in `SearchPlan.raw`, as [start, end) offsets. */
export interface ChipSpan {
  start: number;
  end: number;
}

export interface InterpretedChip {
  key: string;
  label: string;
  /** The query words that set a source, category, or topic chip. */
  text?: string;
  /**
   * Every place in `raw` whose words set this chip, for chips of every kind.
   * Two chips can share a span, as "tonight" sets Today and Evening. The
   * page removes these words when a person removes the chip.
   */
  spans?: ChipSpan[];
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
// A standalone "free". Compounds such as "carbon-free" or "stress-free"
// describe the subject, not the price.
const RE_BARE_FREE = /(?:^|[^\w-])free(?![\w-])/i;

// Only category names lock a category. Subject words such as "tennis" or
// "seminar" stay as ranking text. A lock hid matches filed under another
// primary category (many seminars are Science & Tech), and it left no
// keywords to rank the locked pool by.
const CATEGORY_PATTERNS: Array<[string, RegExp]> = [
  ["Entrepreneurship", /\b(entrepreneurship)\b/i],
  ["Sports", /\b(athletics|sports)\b/i],
  ["Arts", /\b(arts?)\b/i],
  [
    "Science & Tech",
    /\b(science\s*(?:&|and)\s*tech(?:nology)?|tech|technology)\b/i,
  ],
  ["Student Life", /\b(student life|student orgs?)\b/i],
  ["Academic", /\b(academics?)\b/i],
];

const SOURCE_PATTERNS: Array<[string, RegExp, string]> = [
  [
    "bampfa",
    /\b(bampfa|berkeley art museum|pacific film archive)\b/i,
    "BAMPFA",
  ],
  // "cal games" means Cal Bears games. The Sports category also holds
  // Recreational Sports rows such as lap swim, so it would bury them.
  [
    "calbears",
    /\b(cal bears games?|cal games?|bears games?|cal bears|cal athletics|calbears)\b/i,
    "Cal Bears",
  ],
  ["cal_performances", /\b(cal performances)\b/i, "Cal Performances"],
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
  [
    "cltc",
    /\b(cltc|center for long-term cybersecurity|long-term cybersecurity|long term cybersecurity)\b/i,
    "Center for Long-Term Cybersecurity",
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

/**
 * The residual query text with each character's offset in `raw`, or -1 for
 * a space a strip put in. It follows `cleaned` step for step, so a match in
 * the residual text maps back to the words the person typed.
 */
interface TrackedText {
  text: string;
  origin: number[];
}

function trackText(text: string): TrackedText {
  return { text, origin: Array.from({ length: text.length }, (_, i) => i) };
}

/** The same edit as stripIntent, keeping offsets, plus the span removed. */
function stripTracked(
  tracked: TrackedText,
  pattern: RegExp,
): { tracked: TrackedText; span: ChipSpan | null } {
  const match = new RegExp(pattern.source, pattern.flags.replace("g", "")).exec(
    tracked.text,
  );
  let text = tracked.text;
  let origin = tracked.origin;
  let span: ChipSpan | null = null;
  if (match) {
    span = spanAt(tracked, match.index, match[0].length);
    const end = match.index + match[0].length;
    text = `${text.slice(0, match.index)} ${text.slice(end)}`;
    origin = [...origin.slice(0, match.index), -1, ...origin.slice(end)];
  }

  // .replace(/\s+/g, " ").trim(), one character at a time.
  let collapsed = "";
  const collapsedOrigin: number[] = [];
  for (let index = 0; index < text.length; index++) {
    if (/\s/.test(text[index])) {
      if (collapsed.endsWith(" ")) continue;
      collapsed += " ";
    } else {
      collapsed += text[index];
    }
    collapsedOrigin.push(origin[index]);
  }
  let start = 0;
  let stop = collapsed.length;
  while (start < stop && collapsed[start] === " ") start++;
  while (stop > start && collapsed[stop - 1] === " ") stop--;
  return {
    tracked: {
      text: collapsed.slice(start, stop),
      origin: collapsedOrigin.slice(start, stop),
    },
    span,
  };
}

/** The raw span behind characters [index, index + length) of tracked text. */
function spanAt(
  tracked: TrackedText,
  index: number,
  length: number,
): ChipSpan | null {
  let first = index;
  let last = index + length - 1;
  while (first <= last && (tracked.origin[first] ?? -1) < 0) first++;
  while (last >= first && (tracked.origin[last] ?? -1) < 0) last--;
  if (first > last) return null;
  return { start: tracked.origin[first], end: tracked.origin[last] + 1 };
}

/** The first match of a pattern in raw text, as a span. */
function rawSpan(raw: string, pattern: RegExp): ChipSpan | null {
  const match = new RegExp(pattern.source, pattern.flags.replace("g", "")).exec(
    raw,
  );
  return match
    ? { start: match.index, end: match.index + match[0].length }
    : null;
}

function spanList(...spans: Array<ChipSpan | null>): ChipSpan[] {
  const list: ChipSpan[] = [];
  for (const span of spans) {
    if (
      span &&
      !list.some((item) => item.start === span.start && item.end === span.end)
    ) {
      list.push(span);
    }
  }
  return list;
}

function addInterpretationOnce(
  interpretations: InterpretedChip[],
  next: InterpretedChip,
): void {
  const existing = interpretations.find((item) => item.key === next.key);
  if (!existing) {
    interpretations.push(next);
    return;
  }
  // "tonight after work" sets Evening twice. Both phrases belong to it.
  existing.spans = spanList(...(existing.spans ?? []), ...(next.spans ?? []));
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
  for (const expansion of venueAliasExpansions(rawLower)) {
    tokenize(expansion).forEach((token) => expandedSet.add(token));
  }

  return Array.from(expandedSet);
}

export function resolvePlanTopics(
  topics?: readonly SearchTopicDefinition[],
): readonly SearchTopicDefinition[] {
  return topics ?? TOPICS;
}

export interface ExplicitFilters {
  topic?: string | null;
  category?: string | null;
  source?: string | null;
}

/**
 * An explicit filter wins over a different one the query implies. The UI and
 * the agent both dismiss the inferred topic, category, or source this way, so
 * the query words become search text inside the explicit filter.
 */
export function dismissedKeysForExplicitFilters(
  plan: SearchPlan | null,
  explicit: ExplicitFilters,
  extra: Iterable<string> = [],
): Set<string> {
  const keys = new Set(extra);
  if (!plan) return keys;
  for (const field of ["topic", "category", "source"] as const) {
    const inferred = plan.filters[field];
    const chosen = explicit[field];
    if (chosen && inferred && inferred.toLowerCase() !== chosen.toLowerCase()) {
      keys.add(`${field}:${inferred}`);
    }
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
  let tracked = trackText(raw);
  // Strips cleaned and its tracked twin together, and returns the span.
  const strip = (pattern: RegExp): ChipSpan | null => {
    cleaned = stripIntent(cleaned, pattern);
    const result = stripTracked(tracked, pattern);
    tracked = result.tracked;
    return result.span;
  };

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
    const spans = spanList(strip(RE_TONIGHT));
    interpretations.push({ key: "dateRange:today", label: "Today", spans });
    interpretations.push({
      key: "timeOfDay:evening",
      label: "Evening",
      spans: [...spans],
    });
  } else if (RE_TODAY.test(raw)) {
    filters.dateRange = "today";
    interpretations.push({
      key: "dateRange:today",
      label: "Today",
      spans: spanList(strip(RE_TODAY)),
    });
  } else if (RE_TOMORROW.test(raw)) {
    filters.dateRange = "tomorrow";
    interpretations.push({
      key: "dateRange:tomorrow",
      label: "Tomorrow",
      spans: spanList(strip(RE_TOMORROW)),
    });
  } else if (RE_WEEKEND.test(raw)) {
    filters.dateRange = "week";
    filters.weekend = true;
    const spans = spanList(strip(RE_WEEKEND));
    interpretations.push({ key: "dateRange:week", label: "This Week", spans });
    interpretations.push({
      key: "weekend:true",
      label: "This Weekend",
      spans: [...spans],
    });
  } else if (RE_WEEK.test(raw)) {
    filters.dateRange = "week";
    interpretations.push({
      key: "dateRange:week",
      label: "This Week",
      spans: spanList(strip(RE_WEEK)),
    });
  } else if (RE_UPCOMING.test(raw)) {
    filters.dateRange = "upcoming";
    interpretations.push({
      key: "dateRange:upcoming",
      label: "Upcoming",
      spans: spanList(strip(RE_UPCOMING)),
    });
  }

  for (const [source, pattern, label] of SOURCE_PATTERNS) {
    const match = cleaned.match(pattern);
    if (match) {
      filters.source = source;
      interpretations.push({
        key: `source:${source}`,
        label,
        text: match[0],
        spans: spanList(strip(pattern)),
      });
      break;
    }
  }

  const topicSpans = collectTopicSpans(cleaned, topics);
  const firstTopic = topicSpans[0] ?? null;
  if (firstTopic) {
    filters.topic = firstTopic.topic.slug;
    const text = cleaned.slice(
      firstTopic.index,
      firstTopic.index + firstTopic.length,
    );
    interpretations.push({
      key: `topic:${firstTopic.topic.slug}`,
      label: firstTopic.topic.label,
      text,
      spans: spanList(strip(topicPattern(firstTopic.synonym))),
    });
  }

  const remainingSpans = collectTopicSpans(cleaned, topics);
  const detectorText = maskSpans(cleaned, remainingSpans);
  // detectorText keeps cleaned's length, so this snapshot maps its matches.
  const detectorTracked = tracked;
  const detectorSpan = (pattern: RegExp, words?: RegExp): ChipSpan | null => {
    const match = pattern.exec(detectorText);
    if (!match) return null;
    // Narrow to the words that matter, such as "free" in "free food".
    const inner = words ? words.exec(match[0]) : null;
    return inner
      ? spanAt(detectorTracked, match.index + inner.index, inner[0].length)
      : spanAt(detectorTracked, match.index, match[0].length);
  };

  // Time of day reads the raw query but strips the residual text, so its
  // chip owns both the raw match and the words it stripped.
  if (RE_MORNING.test(raw)) {
    filters.timeOfDay = "morning";
    const stripped = strip(RE_MORNING);
    addInterpretationOnce(interpretations, {
      key: "timeOfDay:morning",
      label: "Morning",
      spans: spanList(rawSpan(raw, RE_MORNING), stripped),
    });
  } else if (RE_AFTERNOON_CLOCK.test(raw) || RE_LUNCH.test(detectorText)) {
    filters.timeOfDay = "afternoon";
    const lunch = detectorSpan(RE_LUNCH);
    const clock = strip(RE_AFTERNOON_CLOCK);
    strip(RE_LUNCH);
    addInterpretationOnce(interpretations, {
      key: "timeOfDay:afternoon",
      label: "Afternoon",
      spans: spanList(rawSpan(raw, RE_AFTERNOON_CLOCK), clock, lunch),
    });
  } else if (RE_EVENING.test(raw)) {
    // Runs after "tonight" too, so "tonight after work" strips "after work"
    // instead of leaving it as a required keyword.
    filters.timeOfDay = "evening";
    const stripped = strip(RE_EVENING);
    addInterpretationOnce(interpretations, {
      key: "timeOfDay:evening",
      label: "Evening",
      spans: spanList(rawSpan(raw, RE_EVENING), stripped),
    });
  }

  if (RE_ONLINE.test(detectorText)) {
    filters.modality = "online";
    interpretations.push({
      key: "modality:online",
      label: "Online",
      spans: spanList(detectorSpan(RE_ONLINE)),
    });
    strip(RE_ONLINE);
  } else if (RE_INPERSON.test(detectorText)) {
    filters.modality = "in-person";
    interpretations.push({
      key: "modality:in-person",
      label: "In Person",
      spans: spanList(detectorSpan(RE_INPERSON)),
    });
    strip(RE_INPERSON);
  }

  // The Free chip owns the price words, not the thing that is free: "free
  // food" gives up "free" and keeps "food".
  const RE_PRICE_WORDS = /free|complimentary|no[-\s]?charge|no[-\s]?cost|\$0/i;
  if (RE_CONTEXTUAL_FREE.test(raw)) {
    strip(/\bfree\b/i);
  } else if (RE_FREE.test(detectorText)) {
    filters.free = true;
    interpretations.push({
      key: "free:true",
      label: "Free",
      spans: spanList(detectorSpan(RE_FREE, RE_PRICE_WORDS)),
    });
  } else if (
    firstTopic &&
    RE_BARE_FREE.test(detectorText) &&
    !/\bfree will\b/i.test(raw)
  ) {
    filters.free = true;
    interpretations.push({
      key: "free:true",
      label: "Free",
      spans: spanList(detectorSpan(RE_BARE_FREE, /free/i)),
    });
  }

  for (const [category, pattern] of CATEGORY_PATTERNS) {
    const match = detectorText.match(pattern);
    if (match) {
      filters.category = category;
      interpretations.push({
        key: `category:${category}`,
        label: category,
        text: match[0],
        spans: spanList(detectorSpan(pattern)),
      });
      strip(pattern);
      break;
    }
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
      const stripped = strip(pattern);
      interpretations.push({
        key: `campusArea:${area}`,
        label,
        spans: spanList(rawSpan(raw, pattern), stripped),
      });
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

  // Drop a filter only when its exact key is dismissed. Auto-clear leaves
  // topic:law behind, and that key must not remove the AI topic a later "AI"
  // query implies.
  for (const field of Object.keys(filters) as Array<keyof SearchFilter>) {
    if (dismissedKeys.has(`${field}:${String(filters[field])}`)) {
      delete filters[field];
    }
  }

  // A dismissed source, category, or topic chip turns the words that set it
  // back into search text. "athletics" searches "athletics" rather than
  // "Sports", and "concert" searches "concert" rather than "Music and
  // Performance".
  const dismissedText = plan.interpretations
    .filter(
      (interpretation) =>
        dismissedKeys.has(interpretation.key) &&
        /^(source|category|topic):/.test(interpretation.key),
    )
    .map((interpretation) => interpretation.text ?? interpretation.label)
    .join(" ");

  if (dismissedText) {
    cleaned = [cleaned, dismissedText].filter(Boolean).join(" ");
    keywords = tokenize(cleaned);
    expandedTokens = expandKeywordTokens(
      keywords,
      `${plan.raw} ${dismissedText}`.toLowerCase(),
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

// Punctuation left standing alone once its words are gone, such as the ","
// in "tonight, jazz" or the "?" in "film tonight?".
const LONE_PUNCTUATION = /^[,.;:!?]+$/;

/**
 * The query with the words behind one chip taken out, for the page's ×
 * button. It removes the occurrence that set the chip, as whole words in any
 * case, then collapses spaces, drops punctuation left standing alone, and
 * trims. Chips that share words lose them together: "tonight" sets Today
 * and Evening. A key the query does not set leaves the query as it is.
 *
 * The agent tool's `dismiss` input keeps its own meaning through
 * withDismissedInterpretations.
 */
export function removeChipWords(
  query: string,
  key: string,
  options: BuildSearchPlanOptions = {},
): string {
  const plan = buildSearchPlan(query, options);
  const spans = plan.interpretations.find((item) => item.key === key)?.spans;
  if (!spans || spans.length === 0) return query;

  // Spans count from the trimmed query.
  const offset = query.length - query.trimStart().length;
  let next = query;
  for (const span of [...spans].sort(
    (left, right) => right.start - left.start,
  )) {
    next = `${next.slice(0, offset + span.start)} ${next.slice(offset + span.end)}`;
  }

  return next
    .split(/\s+/)
    .filter((word) => word && !LONE_PUNCTUATION.test(word))
    .join(" ")
    .replace(/[,;:]+$/, "");
}
