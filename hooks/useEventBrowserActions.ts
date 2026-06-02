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
import type { HistoryMode } from "./useUrlStateSync";

interface UseEventBrowserActionsParams {
  filteredEventsCount: number;
  initialSearchQuery: string;
  setFilters: Dispatch<SetStateAction<SearchFilters>>;
  setSelectedEventId: Dispatch<SetStateAction<string | null>>;
  setUserSetDateRange: Dispatch<SetStateAction<boolean>>;
  setDismissedInterpretationKeys: Dispatch<SetStateAction<Set<string>>>;
  onHistoryIntent: (mode: HistoryMode) => void;
  searchTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
}

export function useEventBrowserActions({
  filteredEventsCount,
  initialSearchQuery,
  setFilters,
  setSelectedEventId,
  setUserSetDateRange,
  setDismissedInterpretationKeys,
  onHistoryIntent,
  searchTimeoutRef,
}: UseEventBrowserActionsParams) {
  const prevSearchQueryRef = useRef<string>(initialSearchQuery);
  const latestFilteredEventsCountRef = useRef(filteredEventsCount);

  useEffect(() => {
    latestFilteredEventsCountRef.current = filteredEventsCount;
  }, [filteredEventsCount]);

  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchTimeoutRef]);

  const handleSearchChange = useCallback(
    (query: string) => {
      onHistoryIntent("replace");
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
      onHistoryIntent,
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
      onHistoryIntent("push");
      setUserSetDateRange(true);
      setFilters((prev) => ({ ...prev, dateRange }));
      setDismissedInterpretationKeys(new Set());
      trackDateFilter(dateRange);
    },
    [
      onHistoryIntent,
      setDismissedInterpretationKeys,
      setFilters,
      setUserSetDateRange,
    ],
  );

  const handleCategoryChange = useCallback(
    (category: string) => {
      onHistoryIntent("push");
      setFilters((prev) => ({ ...prev, category }));
      setDismissedInterpretationKeys(new Set());
      trackCategoryFilter(category);
    },
    [onHistoryIntent, setDismissedInterpretationKeys, setFilters],
  );

  const handleSourceChange = useCallback(
    (source: string) => {
      onHistoryIntent("push");
      setFilters((prev) => ({ ...prev, source }));
      setDismissedInterpretationKeys(new Set());
      trackFilter({ filter_type: "source", filter_value: source });
    },
    [onHistoryIntent, setDismissedInterpretationKeys, setFilters],
  );

  const handleQuickPreset = useCallback(
    (preset: QuickFilterPreset) => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }

      onHistoryIntent("push");
      setUserSetDateRange(true);
      setFilters((prev) => ({
        ...prev,
        dateRange: preset.dateRange,
        category: preset.category,
        searchQuery: preset.searchQuery,
      }));
      setDismissedInterpretationKeys(new Set());

      trackDateFilter(preset.dateRange);
      if (preset.category !== "All") {
        trackCategoryFilter(preset.category);
      }
    },
    [
      onHistoryIntent,
      searchTimeoutRef,
      setDismissedInterpretationKeys,
      setFilters,
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
