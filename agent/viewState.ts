import type { SearchFilters } from "../types";

type DateRange = SearchFilters["dateRange"];

/** How many visible event ids a snapshot carries. */
export const VIEW_STATE_EVENT_ID_LIMIT = 20;

/**
 * What the open page shows after it applied the URL and the search engine
 * ran. App publishes it after each render. get_ui_state reads it.
 */
export interface UiViewState {
  /** Pacific date key the page used for its date buckets. */
  todayKey: string;
  loading: "idle" | "loading" | "success" | "error";
  /** True while a typed query has not reached the results yet. */
  pending: boolean;
  /** The query the results reflect (debounced). */
  searchQuery: string;
  /** Range from the date filter or from the query's own date words. */
  requestedDateRange: DateRange;
  /** Range the results come from. */
  effectiveDateRange: DateRange;
  /** True when an empty today or tomorrow widened to the week. */
  dateRangeWidened: boolean;
  /** True when a user or agent chose the date range. */
  hasExplicitDateRange: boolean;
  activeChips: ReadonlyArray<{ key: string; label: string }>;
  dismissedChipKeys: readonly string[];
  resultCount: number;
  /** First rendered event ids, in page order. */
  visibleEventIds: readonly string[];
  fallbackMessage: string | null;
  notice: string | null;
  selectedEventId: string | null;
}

let currentViewState: UiViewState | null = null;

export function publishViewState(state: UiViewState | null): void {
  currentViewState =
    state === null
      ? null
      : Object.freeze({
          ...state,
          activeChips: Object.freeze(
            state.activeChips.map((chip) =>
              Object.freeze({ key: chip.key, label: chip.label }),
            ),
          ),
          dismissedChipKeys: Object.freeze([...state.dismissedChipKeys]),
          visibleEventIds: Object.freeze(
            state.visibleEventIds.slice(0, VIEW_STATE_EVENT_ID_LIMIT),
          ),
        });
}

export function getViewState(): UiViewState | null {
  return currentViewState;
}
