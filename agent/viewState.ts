import type { SearchFilters } from "../types";
import type { AppUrlState } from "../utils/urlState";

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
  /**
   * True while the results can still change: a typed query has not reached
   * them, or the search index has not settled for a query of 2+ characters.
   * get_ui_state also sets it when the URL is ahead of this snapshot.
   */
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
  /** The category, source and topic filters the results reflect. */
  category: string;
  source: string;
  topic: string;
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

function matchesUrl(view: UiViewState, url: AppUrlState): boolean {
  const { filters } = url;
  return (
    view.searchQuery.trim() === filters.searchQuery &&
    view.selectedEventId === url.selectedEventId &&
    view.category === filters.category &&
    view.source === filters.source &&
    view.topic === filters.topic &&
    view.hasExplicitDateRange === url.hasExplicitDateRange &&
    (!url.hasExplicitDateRange || view.requestedDateRange === filters.dateRange)
  );
}

/**
 * The snapshot as get_ui_state reports it. Right after a URL change, the
 * page may not have rendered it yet. The snapshot then reads as pending, so
 * an agent reads again instead of trusting the old view.
 */
export function viewForUrl(
  view: UiViewState | null,
  url: AppUrlState,
): UiViewState | null {
  if (!view || view.pending || matchesUrl(view, url)) return view;
  return Object.freeze({ ...view, pending: true });
}
