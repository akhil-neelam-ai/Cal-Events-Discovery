import { useEffect, useMemo, useState } from "react";

import type { CalEvent, SearchFilters, TopicDefinition } from "../types";
import {
  buildEmptyStateConfig,
  type EmptyStateActions,
  type EmptyStateConfig,
  getFallbackBannerCopy,
} from "../utils/emptyState";
import {
  dateRangeStartKey,
  firstOccurrenceInRange,
  getPacificDateKey,
  sortEventsChronologically,
} from "../utils/eventDates";
import {
  buildSearchPlan,
  dismissedKeysForExplicitFilters,
  searchEvents,
  type InterpretedChip,
} from "../utils/searchEngine";
import type { SearchIndex } from "../utils/textUtils";

interface UseEventBrowserStateParams {
  allEvents: CalEvent[];
  filters: SearchFilters;
  liveSearchQuery: string;
  searchIndex: SearchIndex | null;
  searchIndexSettled: boolean;
  dismissedInterpretationKeys: Set<string>;
  selectedEventId: string | null;
  todayKey: string;
  tomorrowKey: string;
  weekEndKey: string;
  userSetDateRange: boolean;
  topicAvailabilityReady: boolean;
  topicDefinitions: readonly TopicDefinition[] | null;
  onUnavailableTopic: (topic: string) => void;
  emptyStateActions: EmptyStateActions;
}

interface UseEventBrowserStateResult {
  activeChips: InterpretedChip[];
  searchFallbackMessage?: string;
  effectiveDateRange: SearchFilters["dateRange"];
  filteredEvents: CalEvent[];
  topicCounts: ReadonlyMap<string, number>;
  topicFilterNotice: string | null;
  visibleSelectedEventId: string | null;
  selectedEvent: CalEvent | null;
  fallbackBannerCopy: string | null;
  emptyState: EmptyStateConfig;
}

function partitionDateBuckets(
  events: readonly CalEvent[],
  todayKey: string,
  tomorrowKey: string,
  weekEndKey: string,
) {
  const today: CalEvent[] = [];
  const tomorrow: CalEvent[] = [];
  const week: CalEvent[] = [];
  const upcoming: CalEvent[] = [];

  // Bucket by occurrence, not by `date`. A multi-day event runs on every day
  // in `dates`, and its `date` is already past from midnight until the next
  // publish.
  for (const event of events) {
    const next = firstOccurrenceInRange(event, todayKey);
    if (!next) {
      continue;
    }
    upcoming.push(event);
    if (next === todayKey) today.push(event);
    if (firstOccurrenceInRange(event, tomorrowKey, tomorrowKey)) {
      tomorrow.push(event);
    }
    if (next <= weekEndKey) week.push(event);
  }

  return { today, tomorrow, week, upcoming };
}

function bucketForRange(
  buckets: ReturnType<typeof partitionDateBuckets>,
  range: SearchFilters["dateRange"],
): CalEvent[] {
  if (range === "today") return buckets.today;
  if (range === "tomorrow") return buckets.tomorrow;
  if (range === "week") return buckets.week;
  return buckets.upcoming;
}

function eventHasTopic(event: CalEvent, topic: string): boolean {
  return (event.topics ?? []).some((slug) => slug === topic);
}

function countTopics(events: readonly CalEvent[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const event of events) {
    for (const topic of event.topics ?? []) {
      counts.set(topic, (counts.get(topic) ?? 0) + 1);
    }
  }
  return counts;
}

export function useEventBrowserState({
  allEvents,
  filters,
  liveSearchQuery,
  searchIndex,
  searchIndexSettled,
  dismissedInterpretationKeys,
  selectedEventId,
  todayKey,
  tomorrowKey,
  weekEndKey,
  userSetDateRange,
  topicAvailabilityReady,
  topicDefinitions,
  onUnavailableTopic,
  emptyStateActions,
}: UseEventBrowserStateParams): UseEventBrowserStateResult {
  const [topicFilterNotice, setTopicFilterNotice] = useState<string | null>(
    null,
  );
  const searchQueryPending = liveSearchQuery !== filters.searchQuery;
  const planOptions = useMemo(
    () => ({
      topics: topicDefinitions === null ? undefined : topicDefinitions,
    }),
    [topicDefinitions],
  );

  const activePlan = useMemo(() => {
    const query = filters.searchQuery.trim();
    if (query.length < 2) {
      return null;
    }

    return buildSearchPlan(query, planOptions);
  }, [filters.searchQuery, planOptions]);

  const activeChips = useMemo<InterpretedChip[]>(() => {
    if (!activePlan) {
      return [];
    }

    return activePlan.interpretations.filter((interpretation) => {
      if (dismissedInterpretationKeys.has(interpretation.key)) {
        return false;
      }

      if (
        interpretation.key.startsWith("category:") &&
        filters.category !== "All" &&
        interpretation.key !== `category:${filters.category}`
      ) {
        return false;
      }

      if (
        interpretation.key.startsWith("source:") &&
        filters.source !== "All" &&
        interpretation.key !== `source:${filters.source}`
      ) {
        return false;
      }

      if (
        interpretation.key.startsWith("topic:") &&
        filters.topic &&
        interpretation.key !== `topic:${filters.topic}`
      ) {
        return false;
      }

      return true;
    });
  }, [
    activePlan,
    dismissedInterpretationKeys,
    filters.category,
    filters.source,
    filters.topic,
  ]);

  const categorySourcePool = useMemo(() => {
    return allEvents.filter((event) => {
      const eventDateKey = getPacificDateKey(event.date);
      if (!eventDateKey) {
        return false;
      }

      const primaryCategory = event.tags?.[0]?.toLowerCase();
      const matchesCategory =
        filters.category === "All" ||
        primaryCategory === filters.category.toLowerCase();

      const matchesSource =
        filters.source === "All" || event.source === filters.source;

      return matchesCategory && matchesSource;
    });
  }, [allEvents, filters.category, filters.source]);

  const rawDateBuckets = useMemo(
    () =>
      partitionDateBuckets(
        categorySourcePool,
        todayKey,
        tomorrowKey,
        weekEndKey,
      ),
    [categorySourcePool, todayKey, tomorrowKey, weekEndKey],
  );

  const derivedDateRange = useMemo<SearchFilters["dateRange"]>(() => {
    if (userSetDateRange) {
      return filters.dateRange;
    }

    if (
      activePlan?.filters.dateRange &&
      !dismissedInterpretationKeys.has(
        `dateRange:${activePlan.filters.dateRange}`,
      )
    ) {
      return activePlan.filters.dateRange;
    }

    return filters.dateRange;
  }, [
    activePlan,
    dismissedInterpretationKeys,
    filters.dateRange,
    userSetDateRange,
  ]);

  const inferredTopicSlug = activePlan?.filters.topic;
  const searchDismissedKeys = useMemo(
    () =>
      dismissedKeysForExplicitFilters(
        activePlan,
        {
          topic: filters.topic,
          category: filters.category === "All" ? null : filters.category,
          source: filters.source === "All" ? null : filters.source,
        },
        dismissedInterpretationKeys,
      ),
    [
      activePlan,
      dismissedInterpretationKeys,
      filters.category,
      filters.source,
      filters.topic,
    ],
  );

  // A search for today or tomorrow widens to the week when the query matches
  // nothing that day but does match later in the week. The raw pool can't
  // tell: it has events today even when none of them match. Matches found
  // only by dropping a filter are not real matches, so they leave the range.
  const weekMatchBuckets = useMemo(() => {
    const query = filters.searchQuery.trim();
    if (
      query.length < 2 ||
      (derivedDateRange !== "today" && derivedDateRange !== "tomorrow")
    ) {
      return null;
    }

    const pool = filters.topic
      ? rawDateBuckets.week.filter((event) =>
          eventHasTopic(event, filters.topic),
        )
      : rawDateBuckets.week;
    const output = searchEvents(
      pool,
      query,
      searchIndex,
      searchDismissedKeys,
      planOptions,
    );
    if (output.fallbackUsed || output.results.length === 0) {
      return null;
    }
    return partitionDateBuckets(
      output.results,
      todayKey,
      tomorrowKey,
      weekEndKey,
    );
  }, [
    derivedDateRange,
    filters.searchQuery,
    filters.topic,
    planOptions,
    rawDateBuckets.week,
    searchDismissedKeys,
    searchIndex,
    todayKey,
    tomorrowKey,
    weekEndKey,
  ]);

  const effectiveDateRange = useMemo<SearchFilters["dateRange"]>(() => {
    const buckets = weekMatchBuckets ?? rawDateBuckets;
    if (
      derivedDateRange === "today" &&
      buckets.today.length === 0 &&
      buckets.week.length > 0
    ) {
      return "week";
    }

    if (
      derivedDateRange === "tomorrow" &&
      buckets.tomorrow.length === 0 &&
      buckets.week.length > 0
    ) {
      return "week";
    }

    return derivedDateRange;
  }, [derivedDateRange, rawDateBuckets, weekMatchBuckets]);

  const datePool = useMemo(
    () => bucketForRange(rawDateBuckets, effectiveDateRange),
    [effectiveDateRange, rawDateBuckets],
  );

  const availabilityDismissedKeys = useMemo(() => {
    const keys = new Set(searchDismissedKeys);
    if (inferredTopicSlug) {
      keys.add(`topic:${inferredTopicSlug}`);
    }
    return keys;
  }, [inferredTopicSlug, searchDismissedKeys]);

  const availabilityOutput = useMemo(() => {
    const query = filters.searchQuery.trim();
    if (query.length < 2) {
      return {
        results: categorySourcePool,
        fallbackUsed: false,
        fallbackMessage: undefined,
      };
    }

    return searchEvents(
      categorySourcePool,
      query,
      searchIndex,
      availabilityDismissedKeys,
      planOptions,
    );
  }, [
    availabilityDismissedKeys,
    categorySourcePool,
    filters.searchQuery,
    planOptions,
    searchIndex,
  ]);

  const availabilityDateBuckets = useMemo(
    () =>
      partitionDateBuckets(
        availabilityOutput.results,
        todayKey,
        tomorrowKey,
        weekEndKey,
      ),
    [availabilityOutput.results, todayKey, tomorrowKey, weekEndKey],
  );

  // The selected topic and the typed topic count what choosing them shows:
  // the same topic-first search the results grid runs. Counting them from the
  // availability search let a topic label or Fuse's 100-hit cap drop real
  // matches and auto-clear a valid topic. Other chips count events that match
  // the typed words as text.
  const selectedTopicCounts = useMemo(() => {
    const counts = new Map<string, number>();
    const query = filters.searchQuery.trim();
    if (query.length < 2) {
      return counts;
    }

    for (const slug of [filters.topic, inferredTopicSlug]) {
      if (!slug || counts.has(slug)) {
        continue;
      }

      const keys = new Set(searchDismissedKeys);
      if (slug === inferredTopicSlug) {
        keys.delete(`topic:${slug}`);
      }
      const pool = datePool.filter((event) => eventHasTopic(event, slug));
      counts.set(
        slug,
        pool.length === 0
          ? 0
          : searchEvents(pool, query, searchIndex, keys, planOptions).results
              .length,
      );
    }
    return counts;
  }, [
    datePool,
    filters.searchQuery,
    filters.topic,
    inferredTopicSlug,
    planOptions,
    searchDismissedKeys,
    searchIndex,
  ]);

  const topicCounts = useMemo(() => {
    const counts = countTopics(
      bucketForRange(availabilityDateBuckets, effectiveDateRange),
    );
    for (const [slug, count] of selectedTopicCounts) {
      counts.set(slug, count);
    }
    return counts;
  }, [availabilityDateBuckets, effectiveDateRange, selectedTopicCounts]);

  // A search's counts are final only once the index has loaded or failed.
  // Fuse alone misses words late in a description and would clear a topic
  // the index finds.
  const countsReady =
    topicAvailabilityReady &&
    (searchIndexSettled || filters.searchQuery.trim().length < 2);
  const topicUnavailable =
    countsReady &&
    Boolean(filters.topic) &&
    (topicCounts.get(filters.topic) ?? 0) === 0 &&
    !searchQueryPending;
  const renderTopic = topicUnavailable ? "" : filters.topic;

  const searchOutput = useMemo(() => {
    const query = filters.searchQuery.trim();
    const searchPool = renderTopic
      ? datePool.filter((event) => eventHasTopic(event, renderTopic))
      : datePool;

    if (query.length < 2) {
      return {
        results: sortEventsChronologically(searchPool),
        fallbackUsed: false,
        fallbackMessage: undefined,
      };
    }

    // searchEvents' own fallback drops an inferred topic that has no match
    // in this range and keeps the other words and filters. WebMCP gets the
    // same answer.
    return searchEvents(
      searchPool,
      query,
      searchIndex,
      searchDismissedKeys,
      planOptions,
    );
  }, [
    datePool,
    filters.searchQuery,
    planOptions,
    renderTopic,
    searchDismissedKeys,
    searchIndex,
  ]);

  const filteredEvents = useMemo(
    () =>
      sortEventsChronologically(
        searchOutput.results,
        dateRangeStartKey(effectiveDateRange, todayKey),
      ),
    [effectiveDateRange, searchOutput.results, todayKey],
  );

  useEffect(() => {
    if (!countsReady || !filters.topic || searchQueryPending) {
      return;
    }

    if ((topicCounts.get(filters.topic) ?? 0) > 0) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setTopicFilterNotice(
        "Topic cleared because no events match it with the other filters.",
      );
      onUnavailableTopic(filters.topic);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [
    countsReady,
    filters.topic,
    onUnavailableTopic,
    searchQueryPending,
    topicCounts,
  ]);

  useEffect(() => {
    if (!topicFilterNotice) {
      return;
    }

    const timeout = window.setTimeout(() => setTopicFilterNotice(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [topicFilterNotice]);

  const visibleSelectedEventId = useMemo(() => {
    if (!selectedEventId) {
      return null;
    }

    const existsInDataset = allEvents.some(
      (event) => event.id === selectedEventId,
    );
    if (!existsInDataset) {
      return null;
    }

    return selectedEventId;
  }, [allEvents, selectedEventId]);

  const selectedEvent = useMemo(
    () =>
      selectedEventId
        ? (allEvents.find((event) => event.id === selectedEventId) ?? null)
        : null,
    [allEvents, selectedEventId],
  );

  const fallbackBannerCopy = useMemo(
    () =>
      getFallbackBannerCopy({
        derivedDateRange,
        effectiveDateRange,
        weekEventsCount: rawDateBuckets.week.length,
      }),
    [derivedDateRange, effectiveDateRange, rawDateBuckets.week.length],
  );

  const emptyState = useMemo(
    () =>
      buildEmptyStateConfig({
        filters,
        effectiveDateRange,
        derivedDateRange,
        upcomingEventsCount: availabilityDateBuckets.upcoming.length,
        weekEventsCount: availabilityDateBuckets.week.length,
        actions: emptyStateActions,
      }),
    [
      derivedDateRange,
      effectiveDateRange,
      emptyStateActions,
      filters,
      availabilityDateBuckets.upcoming.length,
      availabilityDateBuckets.week.length,
    ],
  );

  return {
    activeChips,
    searchFallbackMessage: searchOutput.fallbackMessage,
    effectiveDateRange,
    filteredEvents,
    topicCounts,
    topicFilterNotice,
    visibleSelectedEventId,
    selectedEvent,
    fallbackBannerCopy,
    emptyState,
  };
}
