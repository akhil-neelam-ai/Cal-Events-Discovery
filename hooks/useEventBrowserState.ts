import { useEffect, useMemo, useState } from "react";

import type { CalEvent, SearchFilters, TopicDefinition } from "../types";
import {
  buildEmptyStateConfig,
  type EmptyStateActions,
  type EmptyStateConfig,
  getFallbackBannerCopy,
} from "../utils/emptyState";
import {
  getPacificDateKey,
  sortEventsChronologically,
} from "../utils/eventDates";
import {
  buildSearchPlan,
  dismissedKeysForExplicitTopic,
  searchEvents,
  type InterpretedChip,
} from "../utils/searchEngine";
import type { SearchIndex } from "../utils/textUtils";

interface UseEventBrowserStateParams {
  allEvents: CalEvent[];
  filters: SearchFilters;
  liveSearchQuery: string;
  searchIndex: SearchIndex | null;
  dismissedInterpretationKeys: Set<string>;
  selectedEventId: string | null;
  todayKey: string;
  tomorrowKey: string;
  nextWeekKey: string;
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
  nextWeekKey: string,
) {
  const today: CalEvent[] = [];
  const tomorrow: CalEvent[] = [];
  const week: CalEvent[] = [];
  const upcoming: CalEvent[] = [];

  for (const event of events) {
    const key = getPacificDateKey(event.date);
    if (!key || key < todayKey) {
      continue;
    }
    upcoming.push(event);
    if (key === todayKey) today.push(event);
    if (key === tomorrowKey) tomorrow.push(event);
    if (key <= nextWeekKey) week.push(event);
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
  dismissedInterpretationKeys,
  selectedEventId,
  todayKey,
  tomorrowKey,
  nextWeekKey,
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
        nextWeekKey,
      ),
    [categorySourcePool, todayKey, tomorrowKey, nextWeekKey],
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

  const effectiveDateRange = useMemo<SearchFilters["dateRange"]>(() => {
    if (
      derivedDateRange === "today" &&
      rawDateBuckets.today.length === 0 &&
      rawDateBuckets.week.length > 0
    ) {
      return "week";
    }

    if (
      derivedDateRange === "tomorrow" &&
      rawDateBuckets.tomorrow.length === 0 &&
      rawDateBuckets.week.length > 0
    ) {
      return "week";
    }

    return derivedDateRange;
  }, [
    derivedDateRange,
    rawDateBuckets.today.length,
    rawDateBuckets.tomorrow.length,
    rawDateBuckets.week.length,
  ]);

  const datePool = useMemo(
    () => bucketForRange(rawDateBuckets, effectiveDateRange),
    [effectiveDateRange, rawDateBuckets],
  );

  const inferredTopicSlug = activePlan?.filters.topic;
  const searchDismissedKeys = useMemo(() => {
    const keys = dismissedKeysForExplicitTopic(
      activePlan,
      filters.topic,
      dismissedInterpretationKeys,
    );
    if (
      activePlan?.filters.category &&
      filters.category !== "All" &&
      activePlan.filters.category !== filters.category
    ) {
      keys.add(`category:${activePlan.filters.category}`);
    }
    if (
      activePlan?.filters.source &&
      filters.source !== "All" &&
      activePlan.filters.source !== filters.source
    ) {
      keys.add(`source:${activePlan.filters.source}`);
    }
    return keys;
  }, [
    activePlan,
    dismissedInterpretationKeys,
    filters.category,
    filters.source,
    filters.topic,
  ]);

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
        nextWeekKey,
      ),
    [availabilityOutput.results, todayKey, tomorrowKey, nextWeekKey],
  );

  const topicCounts = useMemo(
    () =>
      countTopics(bucketForRange(availabilityDateBuckets, effectiveDateRange)),
    [availabilityDateBuckets, effectiveDateRange],
  );

  const topicUnavailable =
    topicAvailabilityReady &&
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

    const output = searchEvents(
      searchPool,
      query,
      searchIndex,
      searchDismissedKeys,
      planOptions,
    );

    if (
      output.results.length === 0 &&
      !renderTopic &&
      inferredTopicSlug &&
      !searchDismissedKeys.has(`topic:${inferredTopicSlug}`) &&
      datePool.length > 0
    ) {
      return {
        results: sortEventsChronologically(datePool),
        fallbackUsed: true,
        fallbackMessage: `No "${activePlan?.interpretations.find((item) => item.key === `topic:${inferredTopicSlug}`)?.label ?? inferredTopicSlug}" results for this date range. Showing all topics.`,
      };
    }

    return output;
  }, [
    activePlan,
    datePool,
    filters.searchQuery,
    inferredTopicSlug,
    planOptions,
    renderTopic,
    searchDismissedKeys,
    searchIndex,
  ]);

  const filteredEvents = useMemo(
    () => sortEventsChronologically(searchOutput.results),
    [searchOutput.results],
  );

  useEffect(() => {
    if (!topicAvailabilityReady || !filters.topic || searchQueryPending) {
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
    filters.topic,
    onUnavailableTopic,
    searchQueryPending,
    topicAvailabilityReady,
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
