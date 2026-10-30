import type { CalEvent } from "../types";
import {
  canWidenToWeek,
  partitionDateBuckets,
  weekSearchMatches,
  widenDateRange,
} from "../utils/dateWidening";
import {
  addDaysToDateKey,
  firstOccurrenceInRange,
  hasEventEnded,
  sortEventsChronologically,
  weekEndKey,
} from "../utils/eventDates";
import {
  buildSearchPlan,
  dismissedKeysForExplicitFilters,
  type RelaxedFilter,
  searchEvents,
} from "../utils/searchEngine";
import type { SearchTopicDefinition } from "../utils/searchIntent";
import type { SearchIndex } from "../utils/textUtils";
import { type DatePreset, resolveDatePreset } from "./filterInput";

// With no date input and no date in the query, search runs from today with
// no end. The UI opens on "week", but an agent asking about a lecture next
// month should still find it.
const DEFAULT_SEARCH_RANGE: DatePreset = "upcoming";

/** Checked search_berkeley_events input. Null means not given. */
export interface AgentSearchInput {
  query: string;
  category: string | null;
  source: string | null;
  topic: string | null;
  datePreset: DatePreset | null;
  startDate: string | null;
  endDate: string | null;
  dismiss: readonly string[];
}

export interface AgentSearchContext {
  events: readonly CalEvent[];
  index: SearchIndex | null;
  topics: SearchTopicDefinition[];
  todayKey: string;
  /** Minutes since midnight on the Pacific clock. */
  nowMinutes: number;
}

export interface AgentSearchResult {
  ranked: CalEvent[];
  fallbackUsed: boolean;
  fallbackMessage: string | null;
  relaxed: RelaxedFilter | null;
  interpretations: { key: string; label: string }[];
  effectiveDateRange: {
    preset: DatePreset | null;
    startDate: string;
    endDate: string | null;
    basis: "input" | "query" | "default";
    requested: DatePreset | null;
    widened: boolean;
  };
}

interface Bounds {
  startDate: string;
  endDate?: string;
}

function hasExplicitDate(input: AgentSearchInput): boolean {
  return Boolean(input.datePreset || input.startDate || input.endDate);
}

/** An error for explicit date input that leaves no days, or null. */
export function checkSearchDates(
  input: AgentSearchInput,
  todayKey: string,
): string | null {
  if (!hasExplicitDate(input)) return null;
  const preset = input.datePreset
    ? resolveDatePreset(input.datePreset, todayKey)
    : null;
  // With no lower bound, rows the feed still holds from yesterday would
  // sort first before each morning's publish. The UI never shows them.
  const startDate = input.startDate ?? preset?.startDate ?? todayKey;
  const endDate = input.endDate ?? preset?.endDate;
  if (endDate && startDate > endDate) {
    return input.startDate || preset
      ? "startDate must be earlier than or equal to endDate"
      : "endDate is before today. Pass startDate to search earlier days.";
  }
  return null;
}

/** Runs one agent search with the UI's pool, date and ranking rules. */
export function runAgentSearch(
  input: AgentSearchInput,
  { events, index, topics, todayKey, nowMinutes }: AgentSearchContext,
): AgentSearchResult {
  const { query, category, source, topic } = input;
  const planOptions = { topics };
  const plan = query.length >= 2 ? buildSearchPlan(query, planOptions) : null;
  // The same rule as the UI: an explicit filter dismisses a different one
  // the query implies, and a dismissed chip stays dismissed.
  const dismissedKeys = dismissedKeysForExplicitFilters(
    plan,
    { topic, category, source },
    input.dismiss,
  );

  // A window that starts today starts now, as in the UI. An event that
  // already ended today is left out.
  const inBounds = (bounds: Bounds) => (event: CalEvent) =>
    firstOccurrenceInRange(event, bounds.startDate, bounds.endDate) !== null &&
    (bounds.startDate < todayKey ||
      !hasEventEnded(event, todayKey, nowMinutes));
  const withTopic = (pool: CalEvent[]) =>
    topic
      ? pool.filter((event) =>
          (event.topics ?? []).some((slug) => slug === topic),
        )
      : pool;
  // The UI's category and source pool, before dates and topic. tags[0] is
  // the primary category.
  const filterPool = events.filter((event) => {
    const primaryCategory = event.tags?.[0]?.toLowerCase() ?? "";
    const matchesCategory =
      !category || primaryCategory === category.toLowerCase();
    const matchesSource = !source || event.source === source;
    return matchesCategory && matchesSource;
  });

  // The date range, in the UI's order: explicit input, then the query's
  // date chip unless dismissed, then the default.
  const inferredRange = plan?.filters.dateRange;
  const basis: "input" | "query" | "default" = hasExplicitDate(input)
    ? "input"
    : inferredRange && !dismissedKeys.has(`dateRange:${inferredRange}`)
      ? "query"
      : "default";
  const requested: DatePreset | null =
    basis === "input"
      ? input.datePreset
      : basis === "query" && inferredRange
        ? inferredRange
        : DEFAULT_SEARCH_RANGE;

  // A query's "today" or "tomorrow" widens to the week by the UI's rule.
  // Explicit date input is a hard bound and never widens.
  let effective = requested;
  if (basis === "query" && requested && canWidenToWeek(requested)) {
    const tomorrowKey = addDaysToDateKey(todayKey, 1);
    const weekEnd = weekEndKey(todayKey);
    const bucket = (pool: readonly CalEvent[]) =>
      partitionDateBuckets(pool, todayKey, tomorrowKey, weekEnd, nowMinutes);
    const raw = bucket(filterPool);
    const matches = weekSearchMatches(
      searchEvents(
        withTopic(raw.week),
        query,
        index,
        dismissedKeys,
        planOptions,
      ),
    );
    effective = widenDateRange(
      requested,
      matches && bucket(matches),
      raw,
    ).range;
  }

  const effectivePreset = effective
    ? resolveDatePreset(effective, todayKey)
    : null;
  const startDate = input.startDate ?? effectivePreset?.startDate ?? todayKey;
  const endDate = input.endDate ?? effectivePreset?.endDate;
  const pool = withTopic(filterPool).filter(inBounds({ startDate, endDate }));

  let ranked: CalEvent[];
  let fallbackUsed = false;
  let fallbackMessage: string | null = null;
  let relaxed: RelaxedFilter | null = null;
  if (query.length < 2) {
    ranked = sortEventsChronologically(pool, startDate);
  } else {
    const output = searchEvents(pool, query, index, dismissedKeys, planOptions);
    ranked = output.results;
    fallbackUsed = output.fallbackUsed;
    fallbackMessage = output.fallbackMessage ?? null;
    relaxed = output.relaxed ?? null;
    // Older published fixtures may predate topic_vocabulary. Preserve their
    // text-search behavior when pure topic intent cannot be applied.
    if (
      topics.length === 0 &&
      (ranked.length === 0 ||
        (fallbackUsed && output.plan.expandedTokens.length === 0))
    ) {
      const needle = query.toLowerCase();
      ranked = sortEventsChronologically(
        pool.filter((event) =>
          `${event.title} ${event.description}`.toLowerCase().includes(needle),
        ),
        startDate,
      );
      fallbackMessage = null;
      relaxed = null;
    }
  }

  return {
    ranked,
    fallbackUsed,
    fallbackMessage,
    relaxed,
    interpretations: (plan?.interpretations ?? [])
      .filter((chip) => !dismissedKeys.has(chip.key))
      .map(({ key, label }) => ({ key, label })),
    effectiveDateRange: {
      preset: input.startDate || input.endDate ? null : effective,
      startDate,
      endDate: endDate ?? null,
      basis,
      requested,
      widened: effective !== requested,
    },
  };
}
