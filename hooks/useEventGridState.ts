import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { VISIBLE_EVENT_BATCH_SIZE } from "../appConfig";
import { LoadingState } from "../types";
import type { CalEvent, SearchFilters } from "../types";
import { buildEventGroups } from "../utils/eventDates";

interface UseEventGridStateParams {
  loading: LoadingState;
  filteredEvents: CalEvent[];
  effectiveDateRange: SearchFilters["dateRange"];
  prefersReducedMotion: boolean;
}

export function useEventGridState({
  loading,
  filteredEvents,
  effectiveDateRange,
  prefersReducedMotion,
}: UseEventGridStateParams) {
  const [shouldAnimateCards, setShouldAnimateCards] =
    useState(!prefersReducedMotion);
  const [visibleEventCount, setVisibleEventCount] = useState(
    VISIBLE_EVENT_BATCH_SIZE,
  );
  const previousDateRangeRef = useRef(effectiveDateRange);
  const previousFilteredEventIdsRef = useRef<Set<string> | null>(null);
  const previousPrefersReducedMotionRef = useRef(prefersReducedMotion);
  const filteredEventsSignature = useMemo(
    () => filteredEvents.map((event) => event.id).join("\u0000"),
    [filteredEvents],
  );

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
    const nextIds = filteredEventsSignature
      ? filteredEventsSignature.split("\u0000")
      : [];
    const previousIds = previousFilteredEventIdsRef.current;
    const nextIsSubset =
      previousIds !== null &&
      nextIds.length <= previousIds.size &&
      nextIds.every((id) => previousIds.has(id));
    const motionChanged =
      previousPrefersReducedMotionRef.current !== prefersReducedMotion;

    previousFilteredEventIdsRef.current = new Set(nextIds);
    previousPrefersReducedMotionRef.current = prefersReducedMotion;

    const frame = window.requestAnimationFrame(() => {
      if (!nextIsSubset) {
        setVisibleEventCount(VISIBLE_EVENT_BATCH_SIZE);
      }

      if (!nextIsSubset || motionChanged) {
        setShouldAnimateCards(!prefersReducedMotion);
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [filteredEventsSignature, prefersReducedMotion]);

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
