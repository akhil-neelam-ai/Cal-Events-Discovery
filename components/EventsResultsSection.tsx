import type { CalEvent, SearchFilters } from "../types";
import { useUpdatedStatusCopy } from "../hooks/useLiveTimestamp";
import type { EventGroup } from "../utils/eventDates";
import type { EmptyStateConfig } from "../utils/emptyState";
import type { InterpretedChip } from "../utils/searchEngine";
import { EmptyStateCard } from "./EmptyStateCard";
import { EventGrid } from "./EventGrid";
import { InterpretedChips } from "./InterpretedChips";

function rangeLabel(dateRange: SearchFilters["dateRange"]) {
  if (dateRange === "today") return "Today";
  if (dateRange === "tomorrow") return "Tomorrow";
  if (dateRange === "week") return "This Week";
  return "Upcoming";
}

export function EventsResultsSection({
  fallbackBannerCopy,
  activeChips,
  onDismissChip,
  category,
  effectiveDateRange,
  filteredEvents,
  lastUpdated,
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
  filteredEvents: CalEvent[];
  lastUpdated: number | null;
  searchFallbackMessage?: string;
  emptyState: EmptyStateConfig;
  eventGroups: EventGroup[];
  visibleEventsCount: number;
  hiddenEventCount: number;
  shouldAnimateCards: boolean;
  onEventClick: (event: CalEvent) => void;
  onLoadMore: () => void;
}) {
  const updatedCopy = useUpdatedStatusCopy(lastUpdated);

  return (
    <>
      {fallbackBannerCopy && (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-xs">
          {fallbackBannerCopy}
        </div>
      )}

      <InterpretedChips chips={activeChips} onDismiss={onDismissChip} />

      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
            Campus feed
          </p>
          <h2 className="mt-1 text-2xl font-semibold text-berkeley-blue md:text-[2rem] md:font-serif">
            {category !== "All" ? `${category} · ` : ""}
            {rangeLabel(effectiveDateRange)}
            <span className="ml-2 text-sm font-normal text-slate-400">
              ({filteredEvents.length})
            </span>
          </h2>
          {updatedCopy && (
            <p className="mt-1 text-sm text-slate-500">{updatedCopy}</p>
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
          onEventClick={onEventClick}
          onLoadMore={onLoadMore}
        />
      )}
    </>
  );
}
