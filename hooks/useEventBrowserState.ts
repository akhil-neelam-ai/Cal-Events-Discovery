import { useMemo } from "react";

import type { CalEvent, SearchFilters } from "../types";
import {
  buildEmptyStateConfig,
  type EmptyStateActions,
  type EmptyStateConfig,
  getFallbackBannerCopy,
} from "../utils/emptyState";
import {
  filterEventsByDateRange,
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
  todayEvents: CalEvent[];
  tomorrowEvents: CalEvent[];
  weekEvents: CalEvent[];
  upcomingEvents: CalEvent[];
  derivedDateRange: SearchFilters["dateRange"];
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

  const todayEvents = useMemo(
    () =>
      filterEventsByDateRange(
        baseFilteredEvents,
        "today",
        todayKey,
        nextWeekKey,
      ),
    [baseFilteredEvents, todayKey, nextWeekKey],
  );

  const tomorrowEvents = useMemo(
    () =>
      filterEventsByDateRange(
        baseFilteredEvents,
        "tomorrow",
        todayKey,
        nextWeekKey,
        tomorrowKey,
      ),
    [baseFilteredEvents, todayKey, nextWeekKey, tomorrowKey],
  );

  const weekEvents = useMemo(
    () =>
      filterEventsByDateRange(
        baseFilteredEvents,
        "week",
        todayKey,
        nextWeekKey,
      ),
    [baseFilteredEvents, todayKey, nextWeekKey],
  );

  const upcomingEvents = useMemo(
    () =>
      filterEventsByDateRange(
        baseFilteredEvents,
        "upcoming",
        todayKey,
        nextWeekKey,
      ),
    [baseFilteredEvents, todayKey, nextWeekKey],
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
      todayEvents.length === 0 &&
      weekEvents.length > 0
    ) {
      return "week";
    }

    if (
      derivedDateRange === "tomorrow" &&
      tomorrowEvents.length === 0 &&
      weekEvents.length > 0
    ) {
      return "week";
    }

    return derivedDateRange;
  }, [
    derivedDateRange,
    todayEvents.length,
    tomorrowEvents.length,
    weekEvents.length,
  ]);

  const filteredEvents = useMemo(() => {
    if (effectiveDateRange === "today") {
      return todayEvents;
    }

    if (effectiveDateRange === "tomorrow") {
      return tomorrowEvents;
    }

    if (effectiveDateRange === "week") {
      return weekEvents;
    }

    return upcomingEvents;
  }, [
    effectiveDateRange,
    todayEvents,
    tomorrowEvents,
    weekEvents,
    upcomingEvents,
  ]);

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
        weekEventsCount: weekEvents.length,
      }),
    [derivedDateRange, effectiveDateRange, weekEvents.length],
  );

  const emptyState = useMemo(
    () =>
      buildEmptyStateConfig({
        filters,
        effectiveDateRange,
        derivedDateRange,
        upcomingEventsCount: upcomingEvents.length,
        weekEventsCount: weekEvents.length,
        actions: emptyStateActions,
      }),
    [
      derivedDateRange,
      effectiveDateRange,
      emptyStateActions,
      filters,
      upcomingEvents.length,
      weekEvents.length,
    ],
  );

  return {
    activeChips,
    searchFallbackMessage: searchOutput.fallbackMessage,
    todayEvents,
    tomorrowEvents,
    weekEvents,
    upcomingEvents,
    derivedDateRange,
    effectiveDateRange,
    filteredEvents,
    visibleSelectedEventId,
    selectedEvent,
    fallbackBannerCopy,
    emptyState,
  };
}
