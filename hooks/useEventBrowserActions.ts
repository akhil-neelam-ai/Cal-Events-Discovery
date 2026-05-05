import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import type { QuickFilterPreset } from "../appConfig";
import type { SearchFilters } from "../types";
import {
  trackCategoryFilter,
  trackDateFilter,
  trackFilter,
  trackSearch,
} from "../utils/analytics";

type HistoryMode = "push" | "replace";

interface UseEventBrowserActionsParams {
  filteredEventsCount: number;
  initialSearchQuery: string;
  setFilters: Dispatch<SetStateAction<SearchFilters>>;
  setSelectedEventId: Dispatch<SetStateAction<string | null>>;
  setUserSetDateRange: Dispatch<SetStateAction<boolean>>;
  setDismissedInterpretationKeys: Dispatch<SetStateAction<Set<string>>>;
  historyModeRef: MutableRefObject<HistoryMode>;
  searchTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
}

export function useEventBrowserActions({
  filteredEventsCount,
  initialSearchQuery,
  setFilters,
  setSelectedEventId,
  setUserSetDateRange,
  setDismissedInterpretationKeys,
  historyModeRef,
  searchTimeoutRef,
}: UseEventBrowserActionsParams) {
  const prevSearchQueryRef = useRef<string>(initialSearchQuery);
  const latestFilteredEventsCountRef = useRef(filteredEventsCount);

  useEffect(() => {
    latestFilteredEventsCountRef.current = filteredEventsCount;
  }, [filteredEventsCount]);

  const handleSearchChange = useCallback(
    (query: string) => {
      historyModeRef.current = "replace";
      setFilters((prev) => ({ ...prev, searchQuery: query }));
      setSelectedEventId(null);

      const prevFirstWord =
        prevSearchQueryRef.current.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
      const nextFirstWord = query.trim().split(/\s+/)[0]?.toLowerCase() ?? "";

      if (prevFirstWord !== nextFirstWord) {
        setDismissedInterpretationKeys(new Set());
      }

      if (query.length === 0) {
        setUserSetDateRange(false);
      }

      prevSearchQueryRef.current = query;

      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }

      if (query.trim().length >= 2) {
        searchTimeoutRef.current = setTimeout(() => {
          trackSearch({
            search_term: query.trim(),
            results_count: latestFilteredEventsCountRef.current,
          });
        }, 500);
      }
    },
    [
      historyModeRef,
      searchTimeoutRef,
      setDismissedInterpretationKeys,
      setFilters,
      setSelectedEventId,
      setUserSetDateRange,
    ],
  );

  const handleDismissChip = useCallback(
    (key: string) => {
      setDismissedInterpretationKeys((prev) => new Set([...prev, key]));
      setSelectedEventId(null);
    },
    [setDismissedInterpretationKeys, setSelectedEventId],
  );

  const handleDateRangeChange = useCallback(
    (dateRange: SearchFilters["dateRange"]) => {
      historyModeRef.current = "push";
      setUserSetDateRange(true);
      setFilters((prev) => ({ ...prev, dateRange }));
      setSelectedEventId(null);
      setDismissedInterpretationKeys(new Set());
      trackDateFilter(dateRange);
    },
    [
      historyModeRef,
      setDismissedInterpretationKeys,
      setFilters,
      setSelectedEventId,
      setUserSetDateRange,
    ],
  );

  const handleCategoryChange = useCallback(
    (category: string) => {
      historyModeRef.current = "push";
      setFilters((prev) => ({ ...prev, category }));
      setSelectedEventId(null);
      setDismissedInterpretationKeys(new Set());
      trackCategoryFilter(category);
    },
    [
      historyModeRef,
      setDismissedInterpretationKeys,
      setFilters,
      setSelectedEventId,
    ],
  );

  const handleSourceChange = useCallback(
    (source: string) => {
      historyModeRef.current = "push";
      setFilters((prev) => ({ ...prev, source }));
      setSelectedEventId(null);
      setDismissedInterpretationKeys(new Set());
      trackFilter({ filter_type: "source", filter_value: source });
    },
    [
      historyModeRef,
      setDismissedInterpretationKeys,
      setFilters,
      setSelectedEventId,
    ],
  );

  const handleQuickPreset = useCallback(
    (preset: QuickFilterPreset) => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }

      historyModeRef.current = "push";
      setUserSetDateRange(true);
      setFilters((prev) => ({
        ...prev,
        dateRange: preset.dateRange,
        category: preset.category,
        searchQuery: preset.searchQuery,
      }));
      setSelectedEventId(null);
      setDismissedInterpretationKeys(new Set());

      trackDateFilter(preset.dateRange);
      if (preset.category !== "All") {
        trackCategoryFilter(preset.category);
      }
    },
    [
      historyModeRef,
      searchTimeoutRef,
      setDismissedInterpretationKeys,
      setFilters,
      setSelectedEventId,
      setUserSetDateRange,
    ],
  );

  return {
    handleSearchChange,
    handleDismissChip,
    handleDateRangeChange,
    handleCategoryChange,
    handleSourceChange,
    handleQuickPreset,
  };
}
