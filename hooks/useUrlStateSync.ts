import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";

import { ALL_SOURCES, Categories, DEFAULT_FILTERS } from "../appConfig";
import type { SearchFilters } from "../types";
import { buildUrlStateSearch, parseUrlState } from "../utils/urlState";

export type HistoryMode = "push" | "replace";

interface UseUrlStateSyncParams {
  filters: SearchFilters;
  selectedEventId: string | null;
  setFilters: Dispatch<SetStateAction<SearchFilters>>;
  setSelectedEventId: Dispatch<SetStateAction<string | null>>;
  setUserSetDateRange: Dispatch<SetStateAction<boolean>>;
}

export interface UseUrlStateSyncResult {
  /** Signal whether the next URL update should push or replace history. */
  onHistoryIntent: (mode: HistoryMode) => void;
}

export function readAppUrlState() {
  return parseUrlState(
    typeof window !== "undefined" ? window.location.search : "",
    {
      defaultFilters: DEFAULT_FILTERS,
      allowedCategories: Categories,
      allowedSources: ALL_SOURCES,
    },
  );
}

export function useUrlStateSync({
  filters,
  selectedEventId,
  setFilters,
  setSelectedEventId,
  setUserSetDateRange,
}: UseUrlStateSyncParams): UseUrlStateSyncResult {
  const historyModeRef = useRef<HistoryMode>("replace");
  const isApplyingHistoryRef = useRef(false);

  const onHistoryIntent = useCallback((mode: HistoryMode) => {
    historyModeRef.current = mode;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const nextSearch = buildUrlStateSearch(filters, selectedEventId, {
      defaultFilters: DEFAULT_FILTERS,
    });
    const nextUrl = `${window.location.pathname}${nextSearch}${window.location.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;

    if (nextUrl !== currentUrl) {
      const historyMethod = isApplyingHistoryRef.current
        ? "replaceState"
        : historyModeRef.current === "push"
          ? "pushState"
          : "replaceState";
      window.history[historyMethod](null, "", nextUrl);
    }

    historyModeRef.current = "replace";
    isApplyingHistoryRef.current = false;
  }, [filters, historyModeRef, isApplyingHistoryRef, selectedEventId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handlePopState = () => {
      isApplyingHistoryRef.current = true;
      const nextState = parseUrlState(window.location.search, {
        defaultFilters: DEFAULT_FILTERS,
        allowedCategories: Categories,
        allowedSources: ALL_SOURCES,
      });

      setFilters(nextState.filters);
      setSelectedEventId(nextState.selectedEventId);
      setUserSetDateRange(nextState.hasExplicitDateRange);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [
    isApplyingHistoryRef,
    setFilters,
    setSelectedEventId,
    setUserSetDateRange,
  ]);

  return { onHistoryIntent };
}
