import type { CalEvent, SearchFilters } from "../types";
import { firstOccurrenceInRange, hasEventEnded } from "./eventDates";
import type { SearchOutput } from "./searchEngine";

// The rule that widens an empty "today" or "tomorrow" to the week. The page
// (hooks/useEventBrowserState.ts) and the agent search tool
// (agent/searchPlan.ts) both call it, so they report the same range.

type DateRange = SearchFilters["dateRange"];

export interface DateBuckets {
  today: CalEvent[];
  tomorrow: CalEvent[];
  week: CalEvent[];
  upcoming: CalEvent[];
}

export function partitionDateBuckets(
  events: readonly CalEvent[],
  todayKey: string,
  tomorrowKey: string,
  weekEndKey: string,
  nowMinutes: number,
): DateBuckets {
  const today: CalEvent[] = [];
  const tomorrow: CalEvent[] = [];
  const week: CalEvent[] = [];
  const upcoming: CalEvent[] = [];

  // Bucket by occurrence, not by `date`. A multi-day event runs on every day
  // in `dates`, and its `date` is already past from midnight until the next
  // publish. An event that already ended today is no longer upcoming.
  for (const event of events) {
    if (hasEventEnded(event, todayKey, nowMinutes)) {
      continue;
    }
    const next = firstOccurrenceInRange(event, todayKey);
    if (!next) {
      continue;
    }
    upcoming.push(event);
    if (next === todayKey) today.push(event);
    if (firstOccurrenceInRange(event, tomorrowKey, tomorrowKey)) {
      tomorrow.push(event);
    }
    if (next <= weekEndKey) week.push(event);
  }

  return { today, tomorrow, week, upcoming };
}

/** True for the ranges that can widen to the week. */
export function canWidenToWeek(range: DateRange): boolean {
  return range === "today" || range === "tomorrow";
}

/**
 * The events a search of the week's pool really matched. Matches found only
 * by dropping a filter are not real matches, so they return null, as does
 * an empty result.
 */
export function weekSearchMatches(output: SearchOutput): CalEvent[] | null {
  return output.fallbackUsed || output.results.length === 0
    ? null
    : output.results;
}

/**
 * A search for today or tomorrow widens to the week when nothing matches
 * that day but something matches later in the week. `matched` buckets the
 * week's real search matches, or is null when there are none. The raw pool
 * decides then: it widens only when that day has no events at all.
 */
export function widenDateRange(
  derived: DateRange,
  matched: DateBuckets | null,
  raw: DateBuckets,
): { range: DateRange; widened: boolean } {
  if (!canWidenToWeek(derived)) return { range: derived, widened: false };
  const buckets = matched ?? raw;
  const day = derived === "today" ? buckets.today : buckets.tomorrow;
  return day.length === 0 && buckets.week.length > 0
    ? { range: "week", widened: true }
    : { range: derived, widened: false };
}
