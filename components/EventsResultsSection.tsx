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

export const RESULTS_ANCHOR_ID = "events";

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
      {/* Chalk on the wall: the view, its count, and the next thing on. */}
      <div id={RESULTS_ANCHOR_ID} tabIndex={-1} className="chalk-head beside">
        <h2 className="view-title">
          {category !== "All" ? `${category} · ` : ""}
          {rangeLabel(effectiveDateRange)}{" "}
          <span className="view-count">({filteredEvents.length})</span>
        </h2>
        {nextUp && (
          <p className="next-up">
            <span>Next up:</span>{" "}
            {nextUpLabel(nextUp, effectiveDateRange, todayKey)}
          </p>
        )}
      </div>

      {fallbackBannerCopy && (
        <div className="note note-gold beside">
          <p>{fallbackBannerCopy}</p>
        </div>
      )}

      <InterpretedChips chips={activeChips} onDismiss={onDismissChip} />

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
        <div className="note beside">
          <p>{searchFallbackMessage}</p>
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
          effectiveDateRange={effectiveDateRange}
          todayKey={todayKey}
          onEventClick={onEventClick}
          onLoadMore={onLoadMore}
        />
      )}
    </>
  );
}
