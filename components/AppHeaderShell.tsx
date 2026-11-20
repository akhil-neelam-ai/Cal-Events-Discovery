import type { QuickFilterPreset } from "../appConfig";
import type { LoadingState, SearchFilters, TopicVocabulary } from "../types";
import { DesktopFiltersBar, MobileFiltersBar } from "./FiltersBar";
import { NoticeSheet } from "./NoticeSheet";

/**
 * The top of the wall: the white notice with search and the date tabs,
 * then the category scraps and the other filters.
 */
export function AppHeaderShell({
  isMobile,
  loading,
  allEventsCount,
  sourceCount,
  todayKey,
  weekEndKey,
  filters,
  activeDateRange,
  topicVocabulary,
  topicCounts,
  onSearchChange,
  onDateChange,
  onCategoryChange,
  onTopicChange,
  onPresetSelect,
  onSurprise,
  onClearAll,
}: {
  isMobile: boolean;
  loading: LoadingState;
  allEventsCount: number;
  sourceCount: number;
  todayKey: string;
  weekEndKey: string;
  filters: SearchFilters;
  activeDateRange: SearchFilters["dateRange"];
  topicVocabulary: TopicVocabulary | null;
  topicCounts: ReadonlyMap<string, number>;
  onSearchChange: (query: string) => void;
  onDateChange: (next: SearchFilters["dateRange"]) => void;
  onCategoryChange: (next: string) => void;
  onTopicChange: (next: string) => void;
  onPresetSelect: (preset: QuickFilterPreset) => void;
  onSurprise: (() => void) | null;
  /** Resets every filter. Null hides "Clear all". */
  onClearAll: (() => void) | null;
}) {
  const filterProps = {
    filters,
    topicVocabulary,
    topicCounts,
    onCategoryChange,
    onTopicChange,
  };

  return (
    <>
      <NoticeSheet
        isMobile={isMobile}
        todayKey={todayKey}
        weekEndKey={weekEndKey}
        loading={loading}
        allEventsCount={allEventsCount}
        sourceCount={sourceCount}
        searchQuery={filters.searchQuery}
        activeDateRange={activeDateRange}
        onSearchChange={onSearchChange}
        onPresetSelect={onPresetSelect}
        onDateChange={onDateChange}
        onSurprise={onSurprise}
      />
      {isMobile ? (
        <MobileFiltersBar {...filterProps} onClearAll={onClearAll} />
      ) : (
        <DesktopFiltersBar {...filterProps} />
      )}
    </>
  );
}
