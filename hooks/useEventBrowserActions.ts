import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import type { QuickFilterPreset } from "../appConfig";
import type { SearchFilters } from "../types";
import {
  removeChipWords,
  type SearchTopicDefinition,
} from "../utils/searchIntent";
import {
  trackCategoryFilter,
  trackDateFilter,
  trackFilter,
  trackSearch,
} from "../utils/analytics";
import type { HistoryMode } from "./useUrlStateSync";

interface UseEventBrowserActionsParams {
  filteredEventsCount: number;
  setFilters: Dispatch<SetStateAction<SearchFilters>>;
  setSelectedEventId: Dispatch<SetStateAction<string | null>>;
  setUserSetDateRange: Dispatch<SetStateAction<boolean>>;
  setDismissedInterpretationKeys: Dispatch<SetStateAction<Set<string>>>;
  onHistoryIntent: (mode: HistoryMode) => void;
  searchTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  /**
   * The last query the actions saw. App owns it so a popstate can reset it
   * to the query the URL brought.
   */
  prevSearchQueryRef: MutableRefObject<string>;
}

export function useEventBrowserActions({
  filteredEventsCount,
  setFilters,
  setSelectedEventId,
  setUserSetDateRange,
  setDismissedInterpretationKeys,
  onHistoryIntent,
  searchTimeoutRef,
  prevSearchQueryRef,
}: UseEventBrowserActionsParams) {
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

  // One path for every change to the query: typing, and removing a chip.
  // Only typing counts as a search for analytics.
  const updateSearchQuery = useCallback(
    (query: string, trackAsSearch: boolean) => {
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

      if (trackAsSearch && query.trim().length >= 2) {
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
      prevSearchQueryRef,
      searchTimeoutRef,
      setDismissedInterpretationKeys,
      setFilters,
      setSelectedEventId,
      setUserSetDateRange,
    ],
  );

  const handleSearchChange = useCallback(
    (query: string) => updateSearchQuery(query, true),
    [updateSearchQuery],
  );

  /**
   * The × on an "Interpreted as" chip takes the words that set the chip out
   * of the query, so the box shows what is searched. A topic chip that
   * matches the explicit topic clears that too.
   */
  const handleRemoveChip = useCallback(
    (key: string, query: string, topics?: readonly SearchTopicDefinition[]) => {
      if (key.startsWith("topic:")) {
        const slug = key.slice("topic:".length);
        setFilters((prev) =>
          prev.topic === slug ? { ...prev, topic: "" } : prev,
        );
      }
      const nextQuery = removeChipWords(query, key, { topics });
      if (nextQuery === query) {
        setSelectedEventId(null);
        return;
      }
      updateSearchQuery(nextQuery, false);
    },
    [setFilters, setSelectedEventId, updateSearchQuery],
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

  const handleTopicChange = useCallback(
    (topic: string) => {
      onHistoryIntent("push");
      setFilters((prev) => ({
        ...prev,
        topic: prev.topic === topic ? "" : topic,
      }));
      setSelectedEventId(null);
      setDismissedInterpretationKeys(new Set());
      trackFilter({ filter_type: "topic", filter_value: topic });
    },
    [
      onHistoryIntent,
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
    handleRemoveChip,
    handleDateRangeChange,
    handleCategoryChange,
    handleTopicChange,
    handleSourceChange,
    handleQuickPreset,
  };
}
