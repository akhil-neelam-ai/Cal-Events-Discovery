import { useCallback, useEffect, useRef, useState } from "react";

import { VISIBLE_EVENT_BATCH_SIZE } from "../appConfig";
import { LoadingState } from "../types";
import type { CalEvent, SearchFilters } from "../types";
import { buildEventGroups } from "../utils/eventDates";

interface UseEventGridStateParams {
  loading: LoadingState;
  filteredEvents: CalEvent[];
  filters: SearchFilters;
  effectiveDateRange: SearchFilters["dateRange"];
  prefersReducedMotion: boolean;
}

export function useEventGridState({
  loading,
  filteredEvents,
  filters,
  effectiveDateRange,
  prefersReducedMotion,
}: UseEventGridStateParams) {
  const [shouldAnimateCards, setShouldAnimateCards] =
    useState(!prefersReducedMotion);
  const [visibleEventCount, setVisibleEventCount] = useState(
    VISIBLE_EVENT_BATCH_SIZE,
  );
  const previousDateRangeRef = useRef(effectiveDateRange);

  useEffect(() => {
    if (
      loading === LoadingState.SUCCESS &&
      filteredEvents.length > 0 &&
      shouldAnimateCards
    ) {
      const timeout = window.setTimeout(
        () => setShouldAnimateCards(false),
        1100,
      );
      return () => window.clearTimeout(timeout);
    }
  }, [filteredEvents.length, loading, shouldAnimateCards]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setVisibleEventCount(VISIBLE_EVENT_BATCH_SIZE);
      setShouldAnimateCards(!prefersReducedMotion);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [filteredEvents, filters, prefersReducedMotion]);

  useEffect(() => {
    if (previousDateRangeRef.current === effectiveDateRange) {
      return;
    }

    previousDateRangeRef.current = effectiveDateRange;
    window.scrollTo({
      top: 0,
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
  }, [effectiveDateRange, prefersReducedMotion]);

  const showMoreEvents = useCallback(() => {
    setVisibleEventCount((count) => count + VISIBLE_EVENT_BATCH_SIZE);
  }, []);

  const visibleEvents = filteredEvents.slice(0, visibleEventCount);
  const hiddenEventCount = Math.max(
    filteredEvents.length - visibleEvents.length,
    0,
  );
  const eventGroups = buildEventGroups(visibleEvents);

  return {
    shouldAnimateCards,
    visibleEvents,
    hiddenEventCount,
    eventGroups,
    showMoreEvents,
  };
}
