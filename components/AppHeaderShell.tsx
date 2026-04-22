import { useId } from "react";

import { Analytics } from "@vercel/analytics/react";

import type { QuickFilterPreset, SourceOption } from "../appConfig";
import { LoadingState, type SearchFilters } from "../types";
import { formatPacificDateTime } from "../utils/eventDates";
import type { StatusBannerData } from "../utils/statusUi";
import { DesktopHero } from "./DesktopHero";
import { DesktopFiltersBar, MobileFiltersBar } from "./FiltersBar";
import { MobileHeader } from "./MobileHeader";
import { StatusBanner } from "./StatusBanner";

export function AppHeaderShell({
  mainContentId,
  isMobile,
  lastUpdated,
  loading,
  allEventsCount,
  sourceCount,
  filters,
  activeDateRange,
  sourceOptions,
  onSearchChange,
  onDateChange,
  onCategoryChange,
  onSourceChange,
  onPresetSelect,
  statusBanner,
  bannerDismissed,
  onDismissBanner,
}: {
  mainContentId: string;
  isMobile: boolean;
  lastUpdated: number | null;
  loading: LoadingState;
  allEventsCount: number;
  sourceCount: number;
  filters: SearchFilters;
  activeDateRange: SearchFilters["dateRange"];
  sourceOptions: SourceOption[];
  onSearchChange: (query: string) => void;
  onDateChange: (next: SearchFilters["dateRange"]) => void;
  onCategoryChange: (next: string) => void;
  onSourceChange: (next: string) => void;
  onPresetSelect: (preset: QuickFilterPreset) => void;
  statusBanner: StatusBannerData | null;
  bannerDismissed: boolean;
  onDismissBanner: () => void;
}) {
  const desktopSearchInputId = useId();

  const desktopHeroStatusCopy = lastUpdated
    ? `Synced ${formatPacificDateTime(lastUpdated)}`
    : loading === LoadingState.ERROR
      ? "Latest batch unavailable"
      : "Loading latest batch";

  const desktopHeroSummaryCopy =
    loading === LoadingState.SUCCESS && allEventsCount > 0
      ? `${allEventsCount.toLocaleString()} events across ${sourceCount} campus feeds. Search by topic, speaker, venue, or organizer.`
      : "Search Berkeley events by topic, speaker, venue, or organizer, then refine with filters below.";

  return (
    <>
      <a
        href={`#${mainContentId}`}
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:bg-berkeley-blue focus:text-white focus:rounded-md focus:text-sm focus:font-medium"
      >
        Skip to events
      </a>
      <Analytics />
      {isMobile ? (
        <>
          <MobileHeader
            lastUpdated={lastUpdated}
            searchQuery={filters.searchQuery}
            onSearchChange={onSearchChange}
          />
          <div className="sticky top-0 z-50">
            <MobileFiltersBar
              filters={filters}
              activeDateRange={activeDateRange}
              sourceOptions={sourceOptions}
              onDateChange={onDateChange}
              onCategoryChange={onCategoryChange}
              onSourceChange={onSourceChange}
            />
          </div>
        </>
      ) : (
        <>
          <DesktopHero
            statusCopy={desktopHeroStatusCopy}
            summaryCopy={desktopHeroSummaryCopy}
            searchQuery={filters.searchQuery}
            onSearchChange={onSearchChange}
            onPresetSelect={onPresetSelect}
            inputId={desktopSearchInputId}
          />
          <div className="sticky top-0 z-50 shadow-sm">
            <DesktopFiltersBar
              filters={filters}
              activeDateRange={activeDateRange}
              sourceOptions={sourceOptions}
              onDateChange={onDateChange}
              onCategoryChange={onCategoryChange}
              onSourceChange={onSourceChange}
            />
          </div>
        </>
      )}

      {statusBanner && !bannerDismissed && (
        <StatusBanner banner={statusBanner} onDismiss={onDismissBanner} />
      )}
    </>
  );
}
