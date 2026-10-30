import {
  ACTIVE_SOURCES,
  Categories,
  DEFAULT_FILTERS,
  RETIRED_SOURCES,
} from "../appConfig";
import type { SearchFilters } from "../types";
import { addDaysToDateKey, weekEndKey } from "../utils/eventDates";

// Filter input checks shared by search_berkeley_events, build_calevents_url
// and apply_ui_state. Every tool uses the same case rule and error format:
// matching ignores case and surrounding spaces, an empty string or "All"
// clears a category or source, and an unknown value reads
// `Unknown <field> "<value>". Use one of: <values>.`

export type DatePreset = SearchFilters["dateRange"];

export const DATE_PRESETS: readonly { value: DatePreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "week", label: "This Week" },
  { value: "upcoming", label: "All Upcoming" },
];

export const DATE_PRESET_VALUES: DatePreset[] = DATE_PRESETS.map(
  (preset) => preset.value,
);

export const SEARCH_CATEGORIES: string[] = Categories.filter(
  (category) => category !== "All",
);

const ALL = "all";
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export type Checked<T> = { value: T } | { error: string };

function unknownValue(field: string, value: string, valid: string): string {
  return `Unknown ${field} "${value}". Use one of: ${valid}.`;
}

/** The trimmed text of a string input, or null for no input. */
function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function isDatePreset(value: unknown): value is DatePreset {
  return DATE_PRESET_VALUES.some((preset) => preset === value);
}

/** Pacific bounds of a preset. "upcoming" has no end. */
export function resolveDatePreset(
  preset: DatePreset,
  todayKey: string,
): { startDate: string; endDate?: string } {
  if (preset === "today") return { startDate: todayKey, endDate: todayKey };
  if (preset === "tomorrow") {
    const tomorrow = addDaysToDateKey(todayKey, 1);
    return { startDate: tomorrow, endDate: tomorrow };
  }
  if (preset === "week") {
    return { startDate: todayKey, endDate: weekEndKey(todayKey) };
  }
  return { startDate: todayKey };
}

/** A category name, or null for none ("", "All", or no input). */
export function checkCategory(value: unknown): Checked<string | null> {
  const wanted = text(value);
  if (wanted === null) return { value: null };
  if (wanted.toLowerCase() === ALL) return { value: null };
  const match = SEARCH_CATEGORIES.find(
    (category) => category.toLowerCase() === wanted.toLowerCase(),
  );
  return match
    ? { value: match }
    : {
        error: unknownValue(
          "category",
          wanted,
          `${SEARCH_CATEGORIES.join(", ")}, or All`,
        ),
      };
}

/** An active source id, or null for none ("", "All", or no input). */
export function checkSource(value: unknown): Checked<string | null> {
  const wanted = text(value);
  if (wanted === null) return { value: null };
  if (wanted.toLowerCase() === ALL) return { value: null };
  const match = ACTIVE_SOURCES.find(
    (source) => source.toLowerCase() === wanted.toLowerCase(),
  );
  if (match) return { value: match };
  const valid = `${ACTIVE_SOURCES.join(", ")}, or All`;
  // CalLink was retired in October 2026. Its id stays valid in old URLs.
  const retired = RETIRED_SOURCES.find(
    (source) => source.toLowerCase() === wanted.toLowerCase(),
  );
  return {
    error: retired
      ? `Source "${retired}" is retired and has no events. Use one of: ${valid}.`
      : unknownValue("source", wanted, valid),
  };
}

/** A date preset, or null when no preset was given. */
export function checkDatePreset(value: unknown): Checked<DatePreset | null> {
  const wanted = text(value);
  if (wanted === null) return { value: null };
  const preset = wanted.toLowerCase();
  return isDatePreset(preset)
    ? { value: preset }
    : { error: unknownValue("date", wanted, DATE_PRESET_VALUES.join(", ")) };
}

/** A YYYY-MM-DD date key, or null when none was given. */
export function checkDateKey(
  field: string,
  value: unknown,
): Checked<string | null> {
  const key = text(value);
  if (key === null) return { value: null };
  if (DATE_KEY_RE.test(key) && addDaysToDateKey(key, 0) === key) {
    return { value: key };
  }
  return { error: `${field} "${key}" is not a date. Use YYYY-MM-DD.` };
}

/** A published topic slug, or null for none. */
export function checkTopic(
  value: unknown,
  allowedTopics: readonly string[],
): Checked<string | null> {
  const wanted = text(value);
  if (wanted === null) return { value: null };
  if (allowedTopics.includes(wanted)) return { value: wanted };
  if (allowedTopics.length === 0) {
    return {
      error: `Unknown topic "${wanted}". No topic vocabulary is published.`,
    };
  }
  return {
    error: `${unknownValue("topic", wanted, allowedTopics.join(", "))} Slugs come from list_filter_options or events.json.topic_vocabulary.topics.`,
  };
}

export function checkDismiss(value: unknown): Checked<string[]> {
  if (value === undefined || value === null) return { value: [] };
  if (
    !Array.isArray(value) ||
    !value.every((key): key is string => typeof key === "string")
  ) {
    return {
      error:
        'dismiss must be an array of chip keys such as "topic:law" or "dateRange:today".',
    };
  }
  return { value: value.map((key) => key.trim()).filter(Boolean) };
}

function readQuery(input: Record<string, unknown>): string | undefined {
  if (typeof input.q === "string") return input.q;
  if (typeof input.query === "string") return input.query;
  return undefined;
}

/** The URL tools take `date`, with `datePreset` as an alias. */
function readDate(input: Record<string, unknown>): unknown {
  return text(input.date) === null ? input.datePreset : input.date;
}

export function inputHasDate(input: Record<string, unknown>): boolean {
  return text(readDate(input)) !== null;
}

export function inputHasTopic(input: Record<string, unknown>): boolean {
  return text(input.topic) !== null;
}

export function searchHasTopic(search: string): boolean {
  const query = search.startsWith("?") ? search.slice(1) : search;
  return Boolean(new URLSearchParams(query).get("topic")?.trim());
}

/**
 * Builds filters from URL tool input on top of `base`. A field the input
 * leaves out keeps its base value. An empty string or "All" clears a
 * category or source. An unknown value is an error, never "All".
 */
export function buildFiltersFromInput(
  input: Record<string, unknown>,
  allowedTopics: readonly string[] = [],
  base: SearchFilters = DEFAULT_FILTERS,
): Checked<SearchFilters> {
  const filters: SearchFilters = { ...base };

  const query = readQuery(input);
  if (query !== undefined) filters.searchQuery = query.trim();

  const date = checkDatePreset(readDate(input));
  if ("error" in date) return date;
  if (date.value) filters.dateRange = date.value;

  if (typeof input.category === "string") {
    const category = checkCategory(input.category);
    if ("error" in category) return category;
    filters.category = category.value ?? DEFAULT_FILTERS.category;
  }

  if (typeof input.source === "string") {
    const source = checkSource(input.source);
    if ("error" in source) return source;
    filters.source = source.value ?? DEFAULT_FILTERS.source;
  }

  if (typeof input.topic === "string") {
    const topic = checkTopic(input.topic, allowedTopics);
    if ("error" in topic) return topic;
    filters.topic = topic.value ?? DEFAULT_FILTERS.topic;
  }

  return { value: filters };
}
