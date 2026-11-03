import type { CalEvent, SearchFilters } from "../types";
import type { EventGroup } from "../utils/eventDates";
import { findNextUpEvent, formatRelativeEventDate } from "../utils/eventDates";
import {
  isRecFacilitySchedule,
  shortenVenue,
} from "../utils/eventPresentation";
import type { EmptyStateConfig } from "../utils/emptyState";
import type { InterpretedChip } from "../utils/searchEngine";
import { EmptyStateCard } from "./EmptyStateCard";
import { EventGrid } from "./EventGrid";
import { InterpretedChips } from "./InterpretedChips";

function rangeLabel(dateRange: SearchFilters["dateRange"]) {
  if (dateRange === "today") return "Today";
  if (dateRange === "tomorrow") return "Tomorrow";
  if (dateRange === "week") return "This Week";
  // Match the "All Events" filter pill so the heading and the active filter
  // agree, instead of the ambiguous standalone "Upcoming".
  return "All Upcoming Events";
}

/** "7pm Women's Basketball, Haas Pavilion", or "Tomorrow 7pm ..." later on. */
function nextUpLabel(
  event: CalEvent,
  dateRange: SearchFilters["dateRange"],
  todayKey: string,
): string {
  const relative = formatRelativeEventDate(
    event,
    undefined,
    dateRange,
    todayKey,
  ).replace(/^Today, /, "");
  const comma = relative.lastIndexOf(", ");
  const when =
    comma === -1
      ? relative
      : `${relative.slice(0, comma)} ${relative.slice(comma + 2)}`;
  const venue = shortenVenue(event.location);
  return `${when} ${event.title}${venue ? `, ${venue}` : ""}`;
}

export function EventsResultsSection({
  fallbackBannerCopy,
  activeChips,
  onDismissChip,
  category,
  effectiveDateRange,
  todayKey,
  nowMinutes,
  filteredEvents,
  searchFallbackMessage,
  emptyState,
  eventGroups,
  visibleEventsCount,
  hiddenEventCount,
  shouldAnimateCards,
  onEventClick,
  onLoadMore,
}: {
  fallbackBannerCopy: string | null;
  activeChips: InterpretedChip[];
  onDismissChip: (key: string) => void;
  category: string;
  effectiveDateRange: SearchFilters["dateRange"];
  todayKey: string;
  nowMinutes: number;
  filteredEvents: CalEvent[];
  searchFallbackMessage?: string;
  emptyState: EmptyStateConfig;
  eventGroups: EventGroup[];
  visibleEventsCount: number;
  hiddenEventCount: number;
  shouldAnimateCards: boolean;
  onEventClick: (event: CalEvent) => void;
  onLoadMore: () => void;
}) {
  const nextUp = findNextUpEvent(
    filteredEvents,
    todayKey,
    nowMinutes,
    isRecFacilitySchedule,
  );
  return (
    <>
      {fallbackBannerCopy && (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-xs">
          {fallbackBannerCopy}
        </div>
      )}

      <InterpretedChips chips={activeChips} onDismiss={onDismissChip} />

      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 max-w-full">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-600">
            Campus feed
          </p>
          <h2 className="mt-1 text-2xl font-semibold text-berkeley-blue md:text-[2rem] md:font-serif">
            {category !== "All" ? `${category} · ` : ""}
            {rangeLabel(effectiveDateRange)}
            <span className="ml-2 text-sm font-normal text-slate-600">
              ({filteredEvents.length})
            </span>
          </h2>
          {/* The header already says the feed updates daily. */}
          {nextUp && (
            <p className="mt-1 truncate text-sm text-slate-600">
              <span className="font-semibold text-slate-700">Next up:</span>{" "}
              {nextUpLabel(nextUp, effectiveDateRange, todayKey)}
            </p>
          )}
        </div>
      </div>

      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {filteredEvents.length === 0
          ? "No events match your filters."
          : `Showing ${filteredEvents.length} ${filteredEvents.length === 1 ? "event" : "events"}.`}
      </div>

      {searchFallbackMessage && (
        <div className="mb-4 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 shadow-xs">
          {searchFallbackMessage}
        </div>
      )}

      {filteredEvents.length === 0 ? (
        <EmptyStateCard state={emptyState} />
      ) : (
        <EventGrid
          eventGroups={eventGroups}
          filteredEventsCount={filteredEvents.length}
          visibleEventsCount={visibleEventsCount}
          hiddenEventCount={hiddenEventCount}
          shouldAnimateCards={shouldAnimateCards}
          effectiveDateRange={effectiveDateRange}
          todayKey={todayKey}
          onEventClick={onEventClick}
          onLoadMore={onLoadMore}
        />
      )}
    </>
  );
}
