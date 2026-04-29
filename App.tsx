import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import { CalEvent, SearchFilters, LoadingState } from "./types";
import { DEFAULT_FILTERS } from "./appConfig";
import { AppFooter } from "./components/AppFooter";
import { BackToTopButton } from "./components/BackToTopButton";
import { AppHeaderShell } from "./components/AppHeaderShell";
import { EventDetailOverlay } from "./components/EventDetailOverlay";
import { ErrorStateView } from "./components/ErrorStateView";
import { EventsResultsSection } from "./components/EventsResultsSection";
import { LoadingStateView } from "./components/LoadingStateView";
import { useEventBrowserActions } from "./hooks/useEventBrowserActions";
import { useEventBrowserState } from "./hooks/useEventBrowserState";
import { useBackToTopVisibility } from "./hooks/useBackToTopVisibility";
import { useEventFeed } from "./hooks/useEventFeed";
import { useEventGridState } from "./hooks/useEventGridState";
import { useIsMobile } from "./hooks/useIsMobile";
import { usePacificDateKeys } from "./hooks/usePacificDateKeys";
import { usePrefersReducedMotion } from "./hooks/usePrefersReducedMotion";
import { readAppUrlState, useUrlStateSync } from "./hooks/useUrlStateSync";
import { initGA, trackPageView, trackEventClick } from "./utils/analytics";
import { buildStatusBanner } from "./utils/statusUi";
import { addRecentSearch } from "./utils/recentSearches";

export default function App() {
  const initialUrlState = readAppUrlState();
  const {
    allEvents,
    lastUpdated,
    loading,
    statusReport,
    searchIndex,
    sourceOptions,
    sourceCount,
    loadEvents,
  } = useEventFeed();
  const prefersReducedMotion = usePrefersReducedMotion();
  const [filters, setFilters] = useState<SearchFilters>(
    initialUrlState.filters,
  );
  const [selectedEventId, setSelectedEventId] = useState<string | null>(
    initialUrlState.selectedEventId,
  );
  const [dismissedInterpretationKeys, setDismissedInterpretationKeys] =
    useState<Set<string>>(new Set());
  const isMobile = useIsMobile();
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyModeRef = useRef<"push" | "replace">("replace");
  const isApplyingHistoryRef = useRef(false);
  const [userSetDateRange, setUserSetDateRange] = useState(
    initialUrlState.hasExplicitDateRange,
  );
  const showBackToTop = useBackToTopVisibility();

  const handleEventClick = useCallback((event: CalEvent) => {
    setSelectedEventId(event.id);
    // Persist the search term that led to this click
    setFilters((prev) => {
      if (prev.searchQuery.trim()) addRecentSearch(prev.searchQuery.trim());
      return prev;
    });
    trackEventClick({
      event_id: event.id,
      event_title: event.title,
      event_category: event.tags?.[0] || "Unknown",
      event_date: event.date,
    });
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedEventId(null);
  }, []);

  useEffect(() => {
    // Initialize GA4 and track page view
    // Vercel Analytics is initialized via the <Analytics /> component wrapper
    initGA();
    trackPageView({
      page_path: "/",
      page_title: "CalEvents - UC Berkeley Events",
    });
  }, []);

  const [bannerDismissed, setBannerDismissed] = useState(
    () =>
      typeof sessionStorage !== "undefined" &&
      sessionStorage.getItem("statusBannerDismissed") === "1",
  );
  const dismissBanner = () => {
    setBannerDismissed(true);
    sessionStorage.setItem("statusBannerDismissed", "1");
  };

  const statusBanner = buildStatusBanner(statusReport);
  const { todayKey, tomorrowKey, nextWeekKey } = usePacificDateKeys();

  const resetAll = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    setSelectedEventId(null);
    setUserSetDateRange(false);
  }, []);

  const clearSearch = useCallback(() => {
    setFilters((prev) => ({ ...prev, searchQuery: "" }));
    setSelectedEventId(null);
    setUserSetDateRange(false);
  }, []);

  const clearCategory = useCallback(() => {
    setFilters((prev) => ({ ...prev, category: DEFAULT_FILTERS.category }));
    setSelectedEventId(null);
  }, []);

  const showWeek = useCallback(() => {
    setFilters((prev) => ({ ...prev, dateRange: "week" }));
    setSelectedEventId(null);
    setUserSetDateRange(true);
  }, []);

  const showUpcoming = useCallback(() => {
    setFilters((prev) => ({ ...prev, dateRange: "upcoming" }));
    setSelectedEventId(null);
    setUserSetDateRange(true);
  }, []);

  const emptyStateActions = useMemo(
    () => ({
      resetAll,
      clearSearch,
      clearCategory,
      showWeek,
      showUpcoming,
    }),
    [resetAll, clearSearch, clearCategory, showWeek, showUpcoming],
  );

  const {
    activeChips,
    searchFallbackMessage,
    effectiveDateRange,
    filteredEvents,
    visibleSelectedEventId,
    selectedEvent,
    fallbackBannerCopy,
    emptyState,
  } = useEventBrowserState({
    allEvents,
    filters,
    searchIndex,
    dismissedInterpretationKeys,
    selectedEventId,
    todayKey,
    tomorrowKey,
    nextWeekKey,
    userSetDateRange,
    emptyStateActions,
  });

  const {
    shouldAnimateCards,
    visibleEvents,
    hiddenEventCount,
    eventGroups,
    showMoreEvents,
  } = useEventGridState({
    loading,
    filteredEvents,
    filters,
    effectiveDateRange,
    prefersReducedMotion,
  });

  const {
    handleSearchChange,
    handleDismissChip,
    handleDateRangeChange,
    handleCategoryChange,
    handleSourceChange,
    handleQuickPreset,
  } = useEventBrowserActions({
    filteredEventsCount: filteredEvents.length,
    initialSearchQuery: initialUrlState.filters.searchQuery,
    setFilters,
    setSelectedEventId,
    setUserSetDateRange,
    setDismissedInterpretationKeys,
    historyModeRef,
    searchTimeoutRef,
  });

  useUrlStateSync({
    filters,
    selectedEventId: visibleSelectedEventId,
    setFilters,
    setSelectedEventId,
    setUserSetDateRange,
    historyModeRef,
    isApplyingHistoryRef,
  });
  const mainContentId = "main-content";

  return (
    <div className="min-h-screen bg-berkeley-lightgray text-gray-800 font-sans">
      <AppHeaderShell
        mainContentId={mainContentId}
        isMobile={isMobile}
        lastUpdated={lastUpdated}
        loading={loading}
        allEventsCount={allEvents.length}
        sourceCount={sourceCount}
        filters={filters}
        activeDateRange={effectiveDateRange}
        sourceOptions={sourceOptions}
        onSearchChange={handleSearchChange}
        onDateChange={handleDateRangeChange}
        onCategoryChange={handleCategoryChange}
        onSourceChange={handleSourceChange}
        onPresetSelect={handleQuickPreset}
        statusBanner={statusBanner}
        bannerDismissed={bannerDismissed}
        onDismissBanner={dismissBanner}
      />

      {/* Main Content */}
      <main id={mainContentId} className="container mx-auto px-4 py-6 md:py-7">
        {loading === LoadingState.LOADING && <LoadingStateView />}

        {loading === LoadingState.ERROR && (
          <ErrorStateView onRetry={loadEvents} />
        )}

        {loading === LoadingState.SUCCESS && (
          <EventsResultsSection
            fallbackBannerCopy={fallbackBannerCopy}
            activeChips={activeChips}
            onDismissChip={handleDismissChip}
            category={filters.category}
            effectiveDateRange={effectiveDateRange}
            filteredEvents={filteredEvents}
            lastUpdated={lastUpdated}
            searchFallbackMessage={searchFallbackMessage}
            emptyState={emptyState}
            eventGroups={eventGroups}
            visibleEventsCount={visibleEvents.length}
            hiddenEventCount={hiddenEventCount}
            shouldAnimateCards={shouldAnimateCards}
            onEventClick={handleEventClick}
            onLoadMore={showMoreEvents}
          />
        )}
      </main>

      <AppFooter />

      {/* Event Detail Panel/Sheet */}
      {selectedEvent && (
        <EventDetailOverlay
          event={selectedEvent}
          isMobile={isMobile}
          onClose={handleCloseDetail}
        />
      )}

      {showBackToTop && <BackToTopButton />}
    </div>
  );
}
