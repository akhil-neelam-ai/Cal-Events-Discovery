import { useId } from "react";

import { Analytics } from "@vercel/analytics/react";

import type { QuickFilterPreset, SourceOption } from "../appConfig";
import { useSyncStatusCopy } from "../hooks/useLiveTimestamp";
import { LoadingState, type SearchFilters } from "../types";
import type { StatusBannerData } from "../utils/statusUi";
import { DesktopHero } from "./DesktopHero";
import { DesktopFiltersBar, MobileFiltersBar } from "./FiltersBar";
import { MobileHeader } from "./MobileHeader";
import { StaleDataBanner } from "./StaleDataBanner";
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
  dataAgeHours,
  degradedSources,
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
  dataAgeHours?: number;
  degradedSources?: string[];
}) {
  const desktopSearchInputId = useId();
  const liveSyncCopy = useSyncStatusCopy(lastUpdated);

  const desktopHeroStatusCopy = liveSyncCopy
    ? liveSyncCopy
    : loading === LoadingState.ERROR
      ? "Latest batch unavailable"
      : "Loading latest batch";

  const showStaleBanner =
    (typeof dataAgeHours === "number" && dataAgeHours > 12) ||
    (degradedSources?.length ?? 0) > 0;

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

      {showStaleBanner && (
        <StaleDataBanner
          dataAgeHours={dataAgeHours ?? 0}
          degradedSources={degradedSources ?? []}
        />
      )}
    </>
  );
}
