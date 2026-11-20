import { useCallback, useEffect, useRef, useState } from "react";

import { VISIBLE_EVENT_BATCH_SIZE } from "../appConfig";
import type { CalEvent, SearchFilters } from "../types";
import { buildEventGroups, dateRangeStartKey } from "../utils/eventDates";

interface UseEventGridStateParams {
  filteredEvents: CalEvent[];
  effectiveDateRange: SearchFilters["dateRange"];
  prefersReducedMotion: boolean;
  todayKey: string;
}

export function useEventGridState({
  filteredEvents,
  effectiveDateRange,
  prefersReducedMotion,
  todayKey,
}: UseEventGridStateParams) {
  const [visibleEventCount, setVisibleEventCount] = useState(
    VISIBLE_EVENT_BATCH_SIZE,
  );
  const previousDateRangeRef = useRef(effectiveDateRange);
  const previousFilteredEventIdsRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    // `filteredEvents` is reference-memoized upstream, so its identity is the
    // change signal. Build the id Set once for the subset check, not on render.
    const nextIds = new Set(filteredEvents.map((event) => event.id));
    const previousIds = previousFilteredEventIdsRef.current;
    const nextIsSubset =
      previousIds !== null &&
      nextIds.size <= previousIds.size &&
      [...nextIds].every((id) => previousIds.has(id));

    previousFilteredEventIdsRef.current = nextIds;

    if (nextIsSubset) return;
    const frame = window.requestAnimationFrame(() => {
      setVisibleEventCount(VISIBLE_EVENT_BATCH_SIZE);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [filteredEvents]);

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
  const eventGroups = buildEventGroups(
    visibleEvents,
    todayKey,
    dateRangeStartKey(effectiveDateRange, todayKey),
  );

  return {
    visibleEvents,
    hiddenEventCount,
    eventGroups,
    showMoreEvents,
  };
}
