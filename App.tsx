import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import { CalEvent, SearchFilters, LoadingState } from "./types";
import { DEFAULT_FILTERS } from "./appConfig";
import { publishViewState } from "./agent/viewState";
import { AppFooter } from "./components/AppFooter";
import { BackToTopButton } from "./components/BackToTopButton";
import { AppHeaderShell } from "./components/AppHeaderShell";
import { EventDetailOverlay } from "./components/EventDetailOverlay";
import { ErrorStateView } from "./components/ErrorStateView";
import { EventsResultsSection } from "./components/EventsResultsSection";
import { LoadingStateView } from "./components/LoadingStateView";
import { useDebouncedValue } from "./hooks/useDebouncedValue";
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
import { addRecentSearch } from "./utils/recentSearches";
import type { AppUrlState } from "./utils/urlState";

const LOADING_LABELS = {
  [LoadingState.IDLE]: "idle",
  [LoadingState.LOADING]: "loading",
  [LoadingState.SUCCESS]: "success",
  [LoadingState.ERROR]: "error",
} as const;

export default function App() {
  const initialUrlState = readAppUrlState();
  const [filters, setFilters] = useState<SearchFilters>(
    initialUrlState.filters,
  );
  const {
    allEvents,
    loading,
    searchIndex,
    searchIndexSettled,
    topicVocabulary,
    sourceOptions,
    sourceCount,
    loadEvents,
  } = useEventFeed(filters.searchQuery.trim().length >= 2);
  const prefersReducedMotion = usePrefersReducedMotion();
  const [selectedEventId, setSelectedEventId] = useState<string | null>(
    initialUrlState.selectedEventId,
  );
  const [dismissedInterpretationKeys, setDismissedInterpretationKeys] =
    useState<Set<string>>(new Set());
  const isMobile = useIsMobile();
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevSearchQueryRef = useRef<string>(
    initialUrlState.filters.searchQuery,
  );
  const [userSetDateRange, setUserSetDateRange] = useState(
    initialUrlState.hasExplicitDateRange,
  );
  const showBackToTop = useBackToTopVisibility();
  // Only a successful load knows the vocabulary. A failed load keeps a URL
  // topic provisional, so Retry can still apply it.
  const feedLoaded = loading === LoadingState.SUCCESS;
  const allowedTopicSlugs = useMemo(
    () =>
      feedLoaded
        ? (topicVocabulary?.topics.map((topic) => topic.slug) ?? [])
        : null,
    [feedLoaded, topicVocabulary],
  );
  const topicDefinitions = useMemo(
    () => (feedLoaded ? (topicVocabulary?.topics ?? []) : null),
    [feedLoaded, topicVocabulary],
  );

  const handleEventClick = useCallback(
    (event: CalEvent) => {
      setSelectedEventId(event.id);
      // Persist the search term that led to this click. This runs here, not
      // in a state updater, which StrictMode calls twice.
      if (filters.searchQuery.trim()) addRecentSearch(filters.searchQuery);
      trackEventClick({
        event_id: event.id,
        event_title: event.title,
        event_category: event.tags?.[0] || "Unknown",
        event_date: event.date,
      });
    },
    [filters.searchQuery],
  );

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

  const { todayKey, tomorrowKey, weekEndKey, nowMinutes } =
    usePacificDateKeys();
  const debouncedSearchQuery = useDebouncedValue(filters.searchQuery, 140);
  const browserStateFilters = useMemo(
    () => ({ ...filters, searchQuery: debouncedSearchQuery }),
    [debouncedSearchQuery, filters],
  );

  const resetAll = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    setSelectedEventId(null);
    setUserSetDateRange(false);
    setDismissedInterpretationKeys(new Set());
  }, []);

  const clearSearch = useCallback(() => {
    setFilters((prev) => ({ ...prev, searchQuery: "" }));
    setSelectedEventId(null);
    setUserSetDateRange(false);
    setDismissedInterpretationKeys(new Set());
  }, []);

  const clearCategory = useCallback(() => {
    setFilters((prev) => ({ ...prev, category: DEFAULT_FILTERS.category }));
    setSelectedEventId(null);
    setDismissedInterpretationKeys(new Set());
  }, []);

  const clearSource = useCallback(() => {
    setFilters((prev) => ({ ...prev, source: DEFAULT_FILTERS.source }));
    setSelectedEventId(null);
    setDismissedInterpretationKeys(new Set());
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

  const clearUnavailableTopic = useCallback((topic: string) => {
    setFilters((prev) =>
      prev.topic === topic ? { ...prev, topic: DEFAULT_FILTERS.topic } : prev,
    );
    setDismissedInterpretationKeys(
      (prev) => new Set([...prev, `topic:${topic}`]),
    );
  }, []);

  const emptyStateActions = useMemo(
    () => ({
      resetAll,
      clearSearch,
      clearCategory,
      clearSource,
      showWeek,
      showUpcoming,
    }),
    [resetAll, clearSearch, clearCategory, clearSource, showWeek, showUpcoming],
  );

  const {
    activeChips,
    searchFallbackMessage,
    derivedDateRange,
    effectiveDateRange,
    filteredEvents,
    visibleSelectedEventId,
    selectedEvent,
    fallbackBannerCopy,
    topicCounts,
    topicFilterNotice,
    emptyState,
  } = useEventBrowserState({
    allEvents,
    filters: browserStateFilters,
    liveSearchQuery: filters.searchQuery,
    searchIndex,
    searchIndexSettled,
    dismissedInterpretationKeys,
    selectedEventId,
    todayKey,
    tomorrowKey,
    weekEndKey,
    nowMinutes,
    userSetDateRange,
    topicAvailabilityReady: allowedTopicSlugs !== null,
    topicDefinitions,
    onUnavailableTopic: clearUnavailableTopic,
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
    effectiveDateRange,
    prefersReducedMotion,
    todayKey,
  });

  // A URL that arrives through popstate (back, forward, or an agent's
  // apply_ui_state) decides the view alone. Chips dismissed on the previous
  // URL do not carry over.
  const handlePopStateApplied = useCallback((state: AppUrlState) => {
    setDismissedInterpretationKeys(new Set());
    prevSearchQueryRef.current = state.filters.searchQuery;
  }, []);

  const { onHistoryIntent } = useUrlStateSync({
    filters,
    allowedTopicSlugs,
    selectedEventId: visibleSelectedEventId,
    setFilters,
    setSelectedEventId,
    setUserSetDateRange,
    userSetDateRange,
    onPopStateApplied: handlePopStateApplied,
  });

  const {
    handleSearchChange,
    handleDismissChip,
    handleDateRangeChange,
    handleCategoryChange,
    handleTopicChange,
    handleSourceChange,
    handleQuickPreset,
  } = useEventBrowserActions({
    filteredEventsCount: filteredEvents.length,
    setFilters,
    setSelectedEventId,
    setUserSetDateRange,
    setDismissedInterpretationKeys,
    onHistoryIntent,
    searchTimeoutRef,
    prevSearchQueryRef,
  });

  // Read-only snapshot of what the page shows, for the get_ui_state tool.
  const notice = topicFilterNotice ?? fallbackBannerCopy;
  useEffect(() => {
    publishViewState({
      todayKey,
      loading: LOADING_LABELS[loading],
      pending: debouncedSearchQuery !== filters.searchQuery,
      searchQuery: debouncedSearchQuery,
      requestedDateRange: derivedDateRange,
      effectiveDateRange,
      dateRangeWidened: effectiveDateRange !== derivedDateRange,
      hasExplicitDateRange: userSetDateRange,
      activeChips,
      dismissedChipKeys: [...dismissedInterpretationKeys],
      resultCount: filteredEvents.length,
      visibleEventIds: visibleEvents.map((event) => event.id),
      fallbackMessage: searchFallbackMessage ?? null,
      notice,
      selectedEventId: visibleSelectedEventId,
    });
  }, [
    activeChips,
    debouncedSearchQuery,
    derivedDateRange,
    dismissedInterpretationKeys,
    effectiveDateRange,
    filteredEvents.length,
    filters.searchQuery,
    loading,
    notice,
    searchFallbackMessage,
    todayKey,
    userSetDateRange,
    visibleEvents,
    visibleSelectedEventId,
  ]);
  useEffect(() => () => publishViewState(null), []);

  const mainContentId = "main-content";

  return (
    <div className="min-h-screen bg-berkeley-lightgray text-gray-800 font-sans">
      <AppHeaderShell
        mainContentId={mainContentId}
        isMobile={isMobile}
        loading={loading}
        allEventsCount={allEvents.length}
        sourceCount={sourceCount}
        filters={filters}
        activeDateRange={effectiveDateRange}
        sourceOptions={sourceOptions}
        topicVocabulary={topicVocabulary}
        topicCounts={topicCounts}
        onSearchChange={handleSearchChange}
        onDateChange={handleDateRangeChange}
        onCategoryChange={handleCategoryChange}
        onTopicChange={handleTopicChange}
        onSourceChange={handleSourceChange}
        onPresetSelect={handleQuickPreset}
      />

      {/* Main Content */}
      <main
        id={mainContentId}
        tabIndex={-1}
        className="container mx-auto px-4 py-6 md:py-7"
      >
        {loading === LoadingState.LOADING && <LoadingStateView />}

        {loading === LoadingState.ERROR && (
          <ErrorStateView onRetry={loadEvents} />
        )}

        {loading === LoadingState.SUCCESS && (
          <EventsResultsSection
            fallbackBannerCopy={notice}
            activeChips={activeChips}
            onDismissChip={handleDismissChip}
            category={filters.category}
            effectiveDateRange={effectiveDateRange}
            todayKey={todayKey}
            filteredEvents={filteredEvents}
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
