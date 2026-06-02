import { useMemo } from "react";

import type { CalEvent, SearchFilters } from "../types";
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
  searchEvents,
  type InterpretedChip,
} from "../utils/searchEngine";
import type { SearchIndex } from "../utils/textUtils";

interface UseEventBrowserStateParams {
  allEvents: CalEvent[];
  filters: SearchFilters;
  searchIndex: SearchIndex | null;
  dismissedInterpretationKeys: Set<string>;
  selectedEventId: string | null;
  todayKey: string;
  tomorrowKey: string;
  nextWeekKey: string;
  userSetDateRange: boolean;
  emptyStateActions: EmptyStateActions;
}

interface UseEventBrowserStateResult {
  activeChips: InterpretedChip[];
  searchFallbackMessage?: string;
  effectiveDateRange: SearchFilters["dateRange"];
  filteredEvents: CalEvent[];
  visibleSelectedEventId: string | null;
  selectedEvent: CalEvent | null;
  fallbackBannerCopy: string | null;
  emptyState: EmptyStateConfig;
}

export function useEventBrowserState({
  allEvents,
  filters,
  searchIndex,
  dismissedInterpretationKeys,
  selectedEventId,
  todayKey,
  tomorrowKey,
  nextWeekKey,
  userSetDateRange,
  emptyStateActions,
}: UseEventBrowserStateParams): UseEventBrowserStateResult {
  const activePlan = useMemo(() => {
    const query = filters.searchQuery.trim();
    if (query.length < 2) {
      return null;
    }

    return buildSearchPlan(query);
  }, [filters.searchQuery]);

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

      return true;
    });
  }, [
    activePlan,
    dismissedInterpretationKeys,
    filters.category,
    filters.source,
  ]);

  const searchOutput = useMemo(() => {
    const query = filters.searchQuery.trim();

    const pool = allEvents.filter((event) => {
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

    if (query.length < 2) {
      return {
        results: sortEventsChronologically(pool),
        fallbackUsed: false,
        fallbackMessage: undefined,
      };
    }

    const effectiveDismissedKeys = new Set(dismissedInterpretationKeys);
    if (
      activePlan?.filters.category &&
      filters.category !== "All" &&
      activePlan.filters.category !== filters.category
    ) {
      effectiveDismissedKeys.add(`category:${activePlan.filters.category}`);
    }

    if (
      activePlan?.filters.source &&
      filters.source !== "All" &&
      activePlan.filters.source !== filters.source
    ) {
      effectiveDismissedKeys.add(`source:${activePlan.filters.source}`);
    }

    const { results, fallbackUsed, fallbackMessage } = searchEvents(
      pool,
      query,
      searchIndex,
      effectiveDismissedKeys,
    );

    return {
      results,
      fallbackUsed,
      fallbackMessage: fallbackUsed ? fallbackMessage : undefined,
    };
  }, [
    allEvents,
    activePlan,
    dismissedInterpretationKeys,
    filters.category,
    filters.searchQuery,
    filters.source,
    searchIndex,
  ]);

  const baseFilteredEvents = searchOutput.results;

  // Partition the base pool into the four (overlapping) date buckets in a
  // single pass. Buckets stay in base order here; only the bucket actually
  // shown is sorted chronologically below, so we avoid four filter+sort passes.
  const dateBuckets = useMemo(() => {
    const today: CalEvent[] = [];
    const tomorrow: CalEvent[] = [];
    const week: CalEvent[] = [];
    const upcoming: CalEvent[] = [];

    for (const event of baseFilteredEvents) {
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
  }, [baseFilteredEvents, todayKey, tomorrowKey, nextWeekKey]);

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
      dateBuckets.today.length === 0 &&
      dateBuckets.week.length > 0
    ) {
      return "week";
    }

    if (
      derivedDateRange === "tomorrow" &&
      dateBuckets.tomorrow.length === 0 &&
      dateBuckets.week.length > 0
    ) {
      return "week";
    }

    return derivedDateRange;
  }, [
    derivedDateRange,
    dateBuckets.today.length,
    dateBuckets.tomorrow.length,
    dateBuckets.week.length,
  ]);

  const filteredEvents = useMemo(() => {
    const activeBucket =
      effectiveDateRange === "today"
        ? dateBuckets.today
        : effectiveDateRange === "tomorrow"
          ? dateBuckets.tomorrow
          : effectiveDateRange === "week"
            ? dateBuckets.week
            : dateBuckets.upcoming;

    return sortEventsChronologically(activeBucket);
  }, [effectiveDateRange, dateBuckets]);

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
        weekEventsCount: dateBuckets.week.length,
      }),
    [derivedDateRange, effectiveDateRange, dateBuckets.week.length],
  );

  const emptyState = useMemo(
    () =>
      buildEmptyStateConfig({
        filters,
        effectiveDateRange,
        derivedDateRange,
        upcomingEventsCount: dateBuckets.upcoming.length,
        weekEventsCount: dateBuckets.week.length,
        actions: emptyStateActions,
      }),
    [
      derivedDateRange,
      effectiveDateRange,
      emptyStateActions,
      filters,
      dateBuckets.upcoming.length,
      dateBuckets.week.length,
    ],
  );

  return {
    activeChips,
    searchFallbackMessage: searchOutput.fallbackMessage,
    effectiveDateRange,
    filteredEvents,
    visibleSelectedEventId,
    selectedEvent,
    fallbackBannerCopy,
    emptyState,
  };
}
