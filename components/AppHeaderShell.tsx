import type { QuickFilterPreset, SourceOption } from "../appConfig";
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
  sourceOptions,
  topicVocabulary,
  topicCounts,
  onSearchChange,
  onDateChange,
  onCategoryChange,
  onTopicChange,
  onSourceChange,
  onPresetSelect,
  onSurprise,
}: {
  isMobile: boolean;
  loading: LoadingState;
  allEventsCount: number;
  sourceCount: number;
  todayKey: string;
  weekEndKey: string;
  filters: SearchFilters;
  activeDateRange: SearchFilters["dateRange"];
  sourceOptions: SourceOption[];
  topicVocabulary: TopicVocabulary | null;
  topicCounts: ReadonlyMap<string, number>;
  onSearchChange: (query: string) => void;
  onDateChange: (next: SearchFilters["dateRange"]) => void;
  onCategoryChange: (next: string) => void;
  onTopicChange: (next: string) => void;
  onSourceChange: (next: string) => void;
  onPresetSelect: (preset: QuickFilterPreset) => void;
  onSurprise: (() => void) | null;
}) {
  const filterProps = {
    filters,
    sourceOptions,
    topicVocabulary,
    topicCounts,
    onCategoryChange,
    onTopicChange,
    onSourceChange,
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
        <MobileFiltersBar {...filterProps} />
      ) : (
        <DesktopFiltersBar {...filterProps} />
      )}
    </>
  );
}
