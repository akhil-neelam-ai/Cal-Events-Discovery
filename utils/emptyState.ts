import { DEFAULT_FILTERS, SOURCE_LABELS } from "../appConfig";
import { SearchFilters } from "../types";

export interface EmptyStateConfig {
  title: string;
  description: string;
  primaryLabel: string;
  primaryAction: () => void;
  secondaryLabel?: string;
  secondaryAction?: () => void;
}

export interface EmptyStateActions {
  resetAll: () => void;
  clearSearch: () => void;
  clearCategory: () => void;
  clearSource: () => void;
  showWeek: () => void;
  showUpcoming: () => void;
}

export function getFallbackBannerCopy({
  derivedDateRange,
  effectiveDateRange,
  weekEventsCount,
}: {
  derivedDateRange: SearchFilters["dateRange"];
  effectiveDateRange: SearchFilters["dateRange"];
  weekEventsCount: number;
}): string | null {
  if (effectiveDateRange !== "week" || weekEventsCount === 0) {
    return null;
  }

  if (derivedDateRange === "today") {
    return "Nothing today — showing this week instead.";
  }

  if (derivedDateRange === "tomorrow") {
    return "Nothing tomorrow — showing this week instead.";
  }

  return null;
}

export function buildEmptyStateConfig({
  filters,
  effectiveDateRange,
  derivedDateRange,
  upcomingEventsCount,
  weekEventsCount,
  actions,
}: {
  filters: SearchFilters;
  effectiveDateRange: SearchFilters["dateRange"];
  derivedDateRange: SearchFilters["dateRange"];
  upcomingEventsCount: number;
  weekEventsCount: number;
  actions: EmptyStateActions;
}): EmptyStateConfig {
  const query = filters.searchQuery.trim();
  const hasSearch = Boolean(query);
  const hasCategory = filters.category !== DEFAULT_FILTERS.category;
  const hasSource = filters.source !== DEFAULT_FILTERS.source;
  const sourceLabel = SOURCE_LABELS[filters.source] || filters.source;

  if (hasSearch && upcomingEventsCount > 0) {
    const dateLabel =
      effectiveDateRange === "today"
        ? "today"
        : effectiveDateRange === "tomorrow"
          ? "tomorrow"
          : effectiveDateRange === "week"
            ? "this week"
            : "upcoming";

    return {
      title: `No “${query}” events ${dateLabel}.`,
      description: `${upcomingEventsCount} match${upcomingEventsCount !== 1 ? "es" : ""} found in the coming weeks — broaden your date range to see them.`,
      primaryLabel:
        effectiveDateRange !== "upcoming" ? "See all upcoming" : "Clear search",
      primaryAction:
        effectiveDateRange !== "upcoming"
          ? actions.showUpcoming
          : actions.clearSearch,
      secondaryLabel: "Clear search",
      secondaryAction: actions.clearSearch,
    };
  }

  if (hasSearch && hasCategory && hasSource) {
    return {
      title: `No “${query}” matches these filters.`,
      description: `Try clearing ${filters.category} and ${sourceLabel} to search the full campus feed.`,
      primaryLabel: "Clear all filters",
      primaryAction: actions.resetAll,
      secondaryLabel: "Clear search",
      secondaryAction: actions.clearSearch,
    };
  }

  if (hasSearch && hasCategory) {
    return {
      title: `No “${query}” in ${filters.category}.`,
      description: `Try removing the ${filters.category} filter — there may be matches across other categories.`,
      primaryLabel: `Clear “${filters.category}”`,
      primaryAction: actions.clearCategory,
      secondaryLabel: "Clear search",
      secondaryAction: actions.clearSearch,
    };
  }

  if (hasSearch && hasSource) {
    return {
      title: `No “${query}” from ${sourceLabel}.`,
      description: `Try removing the ${sourceLabel} source filter — there may be matches from other feeds.`,
      primaryLabel: `Clear “${sourceLabel}”`,
      primaryAction: actions.clearSource,
      secondaryLabel: "Clear search",
      secondaryAction: actions.clearSearch,
    };
  }

  if (hasSearch) {
    return {
      title: `No results for “${query}”.`,
      description: "Try a different search term or browse upcoming events.",
      primaryLabel: "Clear search",
      primaryAction: actions.clearSearch,
      secondaryLabel: "Show all upcoming",
      secondaryAction: actions.resetAll,
    };
  }

  if (
    (derivedDateRange === "today" || derivedDateRange === "tomorrow") &&
    weekEventsCount > 0
  ) {
    return {
      title:
        derivedDateRange === "tomorrow"
          ? "Nothing tomorrow."
          : "Nothing today.",
      description: `${weekEventsCount} event${weekEventsCount !== 1 ? "s" : ""} coming up this week though.`,
      primaryLabel: "Show This Week",
      primaryAction: actions.showWeek,
      secondaryLabel: "Show Upcoming",
      secondaryAction: actions.showUpcoming,
    };
  }

  if (derivedDateRange === "week" && upcomingEventsCount > weekEventsCount) {
    const upcomingBeyondWeek = upcomingEventsCount - weekEventsCount;
    return {
      title: "Nothing is scheduled this week.",
      description: `${upcomingBeyondWeek} more upcoming event${upcomingBeyondWeek !== 1 ? "s are" : " is"} already on the calendar.`,
      primaryLabel: "Show Upcoming",
      primaryAction: actions.showUpcoming,
      secondaryLabel: "Clear all filters",
      secondaryAction: actions.resetAll,
    };
  }

  if (
    filters.category !== DEFAULT_FILTERS.category ||
    filters.source !== DEFAULT_FILTERS.source
  ) {
    return {
      title: "No events match these filters.",
      description:
        "Try a different category or source, or clear the filters to see the full campus feed.",
      primaryLabel: "Clear all filters",
      primaryAction: actions.resetAll,
    };
  }

  return {
    title: "No events match these filters.",
    description: "Try broadening the date range or clearing the active search.",
    primaryLabel: "Clear all filters",
    primaryAction: actions.resetAll,
    secondaryLabel:
      derivedDateRange !== "upcoming" ? "Show Upcoming" : undefined,
    secondaryAction:
      derivedDateRange !== "upcoming" ? actions.showUpcoming : undefined,
  };
}
