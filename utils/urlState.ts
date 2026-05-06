import type { SearchFilters } from "../types";

type DateRange = SearchFilters["dateRange"];

export interface AppUrlState {
  filters: SearchFilters;
  selectedEventId: string | null;
  hasExplicitDateRange: boolean;
}

interface ParseUrlStateOptions {
  defaultFilters: SearchFilters;
  allowedCategories: readonly string[];
  allowedSources: readonly string[];
}

interface BuildUrlStateOptions {
  defaultFilters: SearchFilters;
}

const VALID_DATE_RANGES = new Set<DateRange>([
  "today",
  "tomorrow",
  "week",
  "upcoming",
]);

function sanitizeDateRange(
  value: string | null,
  fallback: DateRange,
): DateRange {
  if (value && VALID_DATE_RANGES.has(value as DateRange)) {
    return value as DateRange;
  }
  return fallback;
}

export function parseUrlState(
  search: string,
  { defaultFilters, allowedCategories, allowedSources }: ParseUrlStateOptions,
): AppUrlState {
  const params = new URLSearchParams(search);
  const rawDateRange = params.get("date");
  const rawSearchQuery = params.get("q")?.trim() ?? "";
  const rawCategory = params.get("category");
  const rawSource = params.get("source");
  const hasExplicitDateRange = Boolean(
    rawDateRange && VALID_DATE_RANGES.has(rawDateRange as DateRange),
  );

  const nextFilters: SearchFilters = {
    ...defaultFilters,
    dateRange: sanitizeDateRange(rawDateRange, defaultFilters.dateRange),
    searchQuery: rawSearchQuery || defaultFilters.searchQuery,
    category:
      rawCategory && allowedCategories.includes(rawCategory)
        ? rawCategory
        : defaultFilters.category,
    source:
      rawSource && allowedSources.includes(rawSource)
        ? rawSource
        : defaultFilters.source,
  };

  const rawEventId = params.get("event")?.trim() ?? "";

  return {
    filters: nextFilters,
    selectedEventId: rawEventId || null,
    hasExplicitDateRange,
  };
}

export function buildUrlStateSearch(
  filters: SearchFilters,
  selectedEventId: string | null,
  { defaultFilters }: BuildUrlStateOptions,
): string {
  const params = new URLSearchParams();
  const query = filters.searchQuery.trim();

  if (query) {
    params.set("q", query);
  }

  if (filters.dateRange !== defaultFilters.dateRange) {
    params.set("date", filters.dateRange);
  }

  if (filters.category !== defaultFilters.category) {
    params.set("category", filters.category);
  }

  if (filters.source !== defaultFilters.source) {
    params.set("source", filters.source);
  }

  if (selectedEventId) {
    params.set("event", selectedEventId);
  }

  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}
