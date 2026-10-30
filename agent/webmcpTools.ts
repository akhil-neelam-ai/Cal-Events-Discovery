import {
  ACTIVE_SOURCES,
  ALL_SOURCES,
  Categories,
  DEFAULT_FILTERS,
  SOURCE_LABELS,
} from "../appConfig";
import type { CalEvent, SearchResponse } from "../types";
import {
  getCurrentPacificDateKey,
  getCurrentPacificMinutes,
} from "../utils/eventDates";
import { getDirectionsUrl } from "../utils/eventPresentation";
import { buildEventIcs, buildGoogleCalendarUrl } from "../utils/icsExport";
import type { SearchTopicDefinition } from "../utils/searchIntent";
import type { SearchIndex } from "../utils/textUtils";
import { buildUrlStateSearch, parseUrlState } from "../utils/urlState";
import {
  buildFiltersFromInput,
  checkCategory,
  checkDateKey,
  checkDatePreset,
  checkDismiss,
  checkSource,
  checkTopic,
  DATE_PRESET_VALUES,
  DATE_PRESETS,
  inputHasDate,
  inputHasTopic,
  SEARCH_CATEGORIES,
  searchHasTopic,
} from "./filterInput";
import {
  type AgentSearchInput,
  checkSearchDates,
  runAgentSearch,
} from "./searchPlan";
import { type UiViewState, viewForUrl } from "./viewState";

const EVENTS_CACHE_TTL_MS = 120_000;
const FETCH_TIMEOUT_MS = 8_000;

export interface WebMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean };
  execute: (input?: Record<string, unknown> | null) => Promise<unknown>;
}

export interface WebMcpDeps {
  fetchJson: (path: string, timeoutMs?: number) => Promise<unknown>;
  getLocationSearch: () => string;
  getOrigin: () => string;
  applyUrlSearch: (search: string) => void;
  /** What the open page shows. Absent or null outside a rendered page. */
  getViewState?: () => UiViewState | null;
  /** The clock for Pacific date keys. Tests pin it. Defaults to now. */
  now?: () => Date;
}

type EventsPayload = SearchResponse & { lastUpdated?: number };

interface CacheEntry {
  fetchedAt: number;
  payload: EventsPayload;
}

function parseLimit(value: unknown): number {
  const parsed = Number(value ?? 10);
  if (!Number.isFinite(parsed)) return 10;
  return Math.min(Math.max(Math.trunc(parsed), 1), 50);
}

function parseOffset(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(Math.trunc(parsed), 0);
}

function findEventById(events: CalEvent[], id: string): CalEvent | null {
  return events.find((event) => event.id === id) ?? null;
}

function summarizeEvent(event: CalEvent) {
  return {
    id: event.id,
    title: event.title,
    date: event.date,
    // Multi-day events only. A date window should match against `dates`.
    end_date: event.end_date,
    dates: event.dates,
    time: event.time,
    // Single-day timed events only, when the source gives an end.
    end_time: event.end_time,
    location: event.location,
    organizer: event.organizer,
    category: event.tags?.[0] ?? null,
    tags: Array.isArray(event.tags) ? event.tags : [],
    topics: Array.isArray(event.topics) ? event.topics : [],
    source: event.source || null,
    url: event.url,
    directionsUrl: getDirectionsUrl(event.location),
    googleCalendarUrl: buildGoogleCalendarUrl(event),
  };
}

function getPublishedTopicSlugs(payload: EventsPayload): string[] {
  return getPublishedTopics(payload).map((topic) => topic.slug);
}

function getPublishedTopics(payload: EventsPayload): SearchTopicDefinition[] {
  if (!Array.isArray(payload.topic_vocabulary?.topics)) {
    return [];
  }

  return payload.topic_vocabulary.topics
    .filter(
      (topic) =>
        typeof topic?.slug === "string" &&
        typeof topic.label === "string" &&
        Array.isArray(topic.synonyms),
    )
    .map((topic) => ({
      slug: topic.slug,
      label: topic.label,
      synonyms: topic.synonyms,
    }));
}

export function createDefaultFetchJson(
  fetchImpl: typeof fetch = fetch,
): WebMcpDeps["fetchJson"] {
  return async function fetchJson(path: string, timeoutMs = FETCH_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(path, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
      }
      return response.json();
    } finally {
      clearTimeout(timeoutId);
    }
  };
}

export function createWebMcpTools(deps: WebMcpDeps): WebMcpTool[] {
  const now = deps.now ?? (() => new Date());
  let eventsCache: CacheEntry | null = null;
  let searchIndexCache: {
    fetchedAt: number;
    index: SearchIndex | null;
  } | null = null;

  async function fetchEventsPayload(): Promise<EventsPayload> {
    const now = Date.now();
    if (eventsCache && now - eventsCache.fetchedAt < EVENTS_CACHE_TTL_MS) {
      return eventsCache.payload;
    }

    const payload = (await deps.fetchJson("/events.json")) as EventsPayload;
    eventsCache = { fetchedAt: now, payload };
    return payload;
  }

  async function allowedTopicsIfNeeded(
    needsVocabulary: boolean,
  ): Promise<string[]> {
    if (!needsVocabulary) return [];
    return getPublishedTopicSlugs(await fetchEventsPayload());
  }

  async function fetchSearchIndex(): Promise<SearchIndex | null> {
    const now = Date.now();
    if (
      searchIndexCache &&
      now - searchIndexCache.fetchedAt < EVENTS_CACHE_TTL_MS
    ) {
      return searchIndexCache.index;
    }

    try {
      const index = (await deps.fetchJson("/search-index.json")) as SearchIndex;
      searchIndexCache = { fetchedAt: now, index };
      return index;
    } catch {
      searchIndexCache = { fetchedAt: now, index: null };
      return null;
    }
  }

  function absoluteUrl(search: string): string {
    const origin = deps.getOrigin().replace(/\/$/, "");
    if (!search) return `${origin}/`;
    if (search.startsWith("?")) return `${origin}/${search}`;
    if (search.startsWith("/")) return `${origin}${search}`;
    return `${origin}/${search}`;
  }

  const searchBerkeleyEvents: WebMcpTool = {
    name: "search_berkeley_events",
    description:
      'Search upcoming UC Berkeley campus events using the same ranked relevance engine as the CalEvents UI (search-index tokens, synonym expansion, intent chips, fuzzy fallback). Optional category/topic/source/date filters match the UI. Topic slugs come from events.json.topic_vocabulary.topics. With no date input, a date in the query ("tomorrow", "this weekend") sets the range, as in the UI; otherwise search runs from today with no end. Results report interpretations (the chips the query set), effectiveDateRange, fallbackMessage, relaxed, and total for paging with offset. Prefer this for discovery; use get_event_by_id for a single known id.',
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            'Natural-language or keyword query. Uses the website ranked search path when length is at least 2 characters. Words such as "tomorrow", "free", or "arts" become filters, listed in interpretations.',
        },
        datePreset: {
          type: "string",
          enum: DATE_PRESET_VALUES,
          description:
            "Optional Pacific-time date bucket. Overrides a date in the query. Explicit startDate/endDate override the matching bound.",
        },
        category: {
          type: "string",
          enum: SEARCH_CATEGORIES,
          description:
            "Optional category filter (primary tag), same as the UI category control.",
        },
        topic: {
          type: "string",
          description:
            "Optional published topic slug. Valid slugs are listed in events.json.topic_vocabulary.topics; do not assume a fixed enum.",
        },
        source: {
          type: "string",
          enum: [...ACTIVE_SOURCES],
          description: `Optional source id: ${ACTIVE_SOURCES.join(", ")}.`,
        },
        startDate: {
          type: "string",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
          description:
            "Optional inclusive Pacific date lower bound in YYYY-MM-DD. Defaults to today, as in the UI. A window that starts today leaves out events whose end_time has passed.",
        },
        endDate: {
          type: "string",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
          description:
            "Optional inclusive Pacific date upper bound in YYYY-MM-DD.",
        },
        dismiss: {
          type: "array",
          items: { type: "string" },
          description:
            'Optional chip keys to drop, taken from a previous result\'s interpretations (for example "topic:law" or "dateRange:tomorrow"). Same as the "x" on a UI chip: the words that set a source, category, or topic chip become search text again.',
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          default: 10,
        },
        offset: {
          type: "integer",
          minimum: 0,
          default: 0,
          description:
            "Skip this many ranked results. Page with offset += limit while offset < total.",
        },
      },
    },
    annotations: { readOnlyHint: true },
    execute: async function executeSearchEvents(input) {
      input = input ?? {};
      const invalid = (error: string) => ({
        error,
        count: 0,
        total: 0,
        events: [],
      });

      const category = checkCategory(input.category);
      if ("error" in category) return invalid(category.error);
      const source = checkSource(input.source);
      if ("error" in source) return invalid(source.error);
      const dismiss = checkDismiss(input.dismiss);
      if ("error" in dismiss) return invalid(dismiss.error);
      const datePreset = checkDatePreset(input.datePreset);
      if ("error" in datePreset) return invalid(datePreset.error);
      const startDate = checkDateKey("startDate", input.startDate);
      if ("error" in startDate) return invalid(startDate.error);
      const endDate = checkDateKey("endDate", input.endDate);
      if ("error" in endDate) return invalid(endDate.error);
      const searchInput: AgentSearchInput = {
        query: typeof input.query === "string" ? input.query.trim() : "",
        category: category.value,
        source: source.value,
        // Checked once the feed has loaded its vocabulary.
        topic: null,
        datePreset: datePreset.value,
        startDate: startDate.value,
        endDate: endDate.value,
        dismiss: dismiss.value,
      };

      const clock = now();
      const todayKey = getCurrentPacificDateKey(clock);
      const dateError = checkSearchDates(searchInput, todayKey);
      if (dateError) return invalid(dateError);

      const [data, index] = await Promise.all([
        fetchEventsPayload(),
        fetchSearchIndex(),
      ]);
      const topics = getPublishedTopics(data);
      const topicCheck = checkTopic(
        input.topic,
        topics.map((item) => item.slug),
      );
      if ("error" in topicCheck) return invalid(topicCheck.error);
      searchInput.topic = topicCheck.value;

      const result = runAgentSearch(searchInput, {
        events: Array.isArray(data.events) ? data.events : [],
        index,
        topics,
        todayKey,
        nowMinutes: getCurrentPacificMinutes(clock),
      });

      const offset = parseOffset(input.offset);
      const limit = parseLimit(input.limit);
      const results = result.ranked
        .slice(offset, offset + limit)
        .map(summarizeEvent);

      return {
        lastUpdated: data.lastUpdated,
        count: results.length,
        total: result.ranked.length,
        offset,
        limit,
        fallbackUsed: result.fallbackUsed,
        fallbackMessage: result.fallbackMessage,
        relaxed: result.relaxed,
        ranked: searchInput.query.length >= 2,
        interpretations: result.interpretations,
        effectiveDateRange: result.effectiveDateRange,
        events: results,
        todayKey,
      };
    },
  };

  const getEventById: WebMcpTool = {
    name: "get_event_by_id",
    description:
      "Fetch a single CalEvents event by id (same id as ?event=<id>). Returns the event plus directionsUrl, googleCalendarUrl, and a CalEvents permalink when available.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The event id to look up.",
        },
      },
      required: ["id"],
    },
    annotations: { readOnlyHint: true },
    execute: async function executeGetEventById(input) {
      input = input ?? {};
      if (!input.id || typeof input.id !== "string") {
        return { error: "id is required", event: null };
      }

      const data = await fetchEventsPayload();
      const events = Array.isArray(data.events) ? data.events : [];
      const event = findEventById(events, input.id);
      if (!event) {
        return { lastUpdated: data.lastUpdated, event: null };
      }

      const search = buildUrlStateSearch(DEFAULT_FILTERS, event.id, {
        defaultFilters: DEFAULT_FILTERS,
      });

      return {
        lastUpdated: data.lastUpdated,
        event: {
          ...event,
          directionsUrl: getDirectionsUrl(event.location),
          googleCalendarUrl: buildGoogleCalendarUrl(event),
          permalink: absoluteUrl(
            search || `?event=${encodeURIComponent(event.id)}`,
          ),
        },
      };
    },
  };

  const generateEventIcs: WebMcpTool = {
    name: "generate_event_ics",
    description:
      "Generate an RFC 5545 iCalendar (.ics) string for a single CalEvents event by id. Times use America/Los_Angeles.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The event id to export.",
        },
      },
      required: ["id"],
    },
    annotations: { readOnlyHint: true },
    execute: async function executeGenerateEventIcs(input) {
      input = input ?? {};
      if (!input.id || typeof input.id !== "string") {
        return { error: "id is required", ics: null };
      }

      const data = await fetchEventsPayload();
      const events = Array.isArray(data.events) ? data.events : [];
      const event = findEventById(events, input.id);
      if (!event) {
        return { error: `no event found for id ${input.id}`, ics: null };
      }

      return {
        id: event.id,
        filename: `event-${String(event.id).replace(/[^\w.-]+/g, "_")}.ics`,
        ics: buildEventIcs(event),
        googleCalendarUrl: buildGoogleCalendarUrl(event),
      };
    },
  };

  const feedStatus: WebMcpTool = {
    name: "get_cal_events_feed_status",
    description:
      "Inspect CalEvents source freshness, ingestion status, fallback usage, and data-quality state.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    execute: async function executeFeedStatus() {
      return deps.fetchJson("/status.json");
    },
  };

  const getUiState: WebMcpTool = {
    name: "get_ui_state",
    description:
      "Read the current CalEvents UI workspace. Returns the URL state (filters q/date/category/topic/source, selected event id), todayKey (Pacific), and `view`: what the page shows after the search engine ran. `view` holds requestedDateRange, effectiveDateRange, dateRangeWidened, activeChips, dismissedChipKeys, resultCount, the first visibleEventIds, fallbackMessage, notice, loading, and pending. It is null when no page has rendered. Read it again if pending is true or loading is not success. Topic slugs come from events.json.topic_vocabulary.topics. Optional feed freshness from status.json.",
    inputSchema: {
      type: "object",
      properties: {
        includeFeedStatus: {
          type: "boolean",
          description:
            "When true, also fetch status.json for freshness fields. Defaults to false.",
        },
      },
    },
    annotations: { readOnlyHint: true },
    execute: async function executeGetUiState(input) {
      input = input ?? {};
      const locationSearch = deps.getLocationSearch();
      const urlState = parseUrlState(locationSearch, {
        defaultFilters: DEFAULT_FILTERS,
        allowedCategories: Categories,
        allowedSources: ALL_SOURCES,
        allowedTopics: await allowedTopicsIfNeeded(
          searchHasTopic(locationSearch),
        ),
      });

      const result: Record<string, unknown> = {
        filters: urlState.filters,
        selectedEventId: urlState.selectedEventId,
        hasExplicitDateRange: urlState.hasExplicitDateRange,
        url: absoluteUrl(locationSearch || ""),
        todayKey: getCurrentPacificDateKey(now()),
        view: viewForUrl(deps.getViewState?.() ?? null, urlState),
      };

      if (input.includeFeedStatus === true) {
        try {
          result.feedStatus = await deps.fetchJson("/status.json");
        } catch (error) {
          result.feedStatusError =
            error instanceof Error ? error.message : "failed to load status";
        }
      }

      return result;
    },
  };

  const buildCaleventsUrl: WebMcpTool = {
    name: "build_calevents_url",
    description:
      "Build a CalEvents deep-link URL from query/date/category/topic/source/event without changing the open page. Query params: q, date, category, topic, source, event. Valid categories, sources, dates and topic slugs come from list_filter_options. An unknown value returns an error.",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Search query (?q=)." },
        query: {
          type: "string",
          description: "Alias for q.",
        },
        date: {
          type: "string",
          enum: DATE_PRESET_VALUES,
          description: "Date bucket (?date=).",
        },
        datePreset: {
          type: "string",
          enum: DATE_PRESET_VALUES,
          description: "Alias for date.",
        },
        category: {
          type: "string",
          description: 'Category or "All". See list_filter_options.',
        },
        source: {
          type: "string",
          description: 'Active source id or "All". See list_filter_options.',
        },
        topic: {
          type: "string",
          description:
            "Published topic slug from events.json.topic_vocabulary.",
        },
        event: {
          type: "string",
          description: "Selected event id (?event=).",
        },
      },
    },
    annotations: { readOnlyHint: true },
    execute: async function executeBuildUrl(input) {
      input = input ?? {};
      const allowedTopics = await allowedTopicsIfNeeded(inputHasTopic(input));
      const resolved = buildFiltersFromInput(input, allowedTopics);
      if ("error" in resolved) return { error: resolved.error };
      const filters = resolved.value;
      const eventId =
        typeof input.event === "string" && input.event.trim()
          ? input.event.trim()
          : null;
      const search = buildUrlStateSearch(filters, eventId, {
        defaultFilters: DEFAULT_FILTERS,
        explicitDateRange: inputHasDate(input),
      });
      return {
        search,
        url: absoluteUrl(search || ""),
        filters,
        selectedEventId: eventId,
      };
    },
  };

  const applyUiState: WebMcpTool = {
    name: "apply_ui_state",
    description:
      "Update the open CalEvents page to match shared URL workspace state (q/date/category/topic/source/event). The default mode is replace: every field you leave out returns to its default, and the detail panel closes unless you pass event. Use mode merge to change only the fields you pass and keep the rest of the current URL. Pass reset true to return to the default view. Pass event null to close the detail panel. Valid categories, sources, dates and topic slugs come from list_filter_options. An unknown value or event id returns applied false with an error. The React UI syncs via history + popstate.",
    inputSchema: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["replace", "merge"],
          default: "replace",
          description:
            "replace starts from the default view. merge starts from the current URL state.",
        },
        reset: {
          type: "boolean",
          description:
            "When true, start from the default view whatever the mode. Fields you pass still apply.",
        },
        q: { type: "string" },
        query: { type: "string", description: "Alias for q." },
        date: {
          type: "string",
          enum: DATE_PRESET_VALUES,
        },
        datePreset: {
          type: "string",
          enum: DATE_PRESET_VALUES,
          description: "Alias for date.",
        },
        category: {
          type: "string",
          description: 'Category or "All". See list_filter_options.',
        },
        source: {
          type: "string",
          description: 'Active source id or "All". See list_filter_options.',
        },
        topic: {
          type: "string",
          description:
            'Published topic slug from list_filter_options, or "" to clear.',
        },
        event: {
          type: ["string", "null"],
          description:
            "Event id to open in the detail panel. Must exist in events.json. null closes the panel.",
        },
      },
    },
    annotations: { readOnlyHint: false },
    execute: async function executeApplyUiState(input) {
      input = input ?? {};
      const mode = input.mode ?? "replace";
      if (mode !== "replace" && mode !== "merge") {
        return {
          applied: false,
          error: `Unknown mode "${String(mode)}". Use replace or merge.`,
        };
      }
      const fromCurrent = mode === "merge" && input.reset !== true;
      const locationSearch = fromCurrent ? deps.getLocationSearch() : "";

      const allowedTopics = await allowedTopicsIfNeeded(
        inputHasTopic(input) || searchHasTopic(locationSearch),
      );
      const current = fromCurrent
        ? parseUrlState(locationSearch, {
            defaultFilters: DEFAULT_FILTERS,
            allowedCategories: Categories,
            allowedSources: ALL_SOURCES,
            allowedTopics,
          })
        : {
            filters: DEFAULT_FILTERS,
            selectedEventId: null,
            hasExplicitDateRange: false,
          };

      const resolved = buildFiltersFromInput(
        input,
        allowedTopics,
        current.filters,
      );
      if ("error" in resolved) return { applied: false, error: resolved.error };
      const filters = resolved.value;

      let eventId: string | null = current.selectedEventId;
      if (input.event === null) {
        eventId = null;
      } else if (typeof input.event === "string") {
        eventId = input.event.trim() || null;
      }
      // Check every id, including one merge keeps from the URL. The page
      // closes the panel for an id the feed no longer has.
      if (eventId) {
        const data = await fetchEventsPayload();
        const events = Array.isArray(data.events) ? data.events : [];
        if (!findEventById(events, eventId)) {
          return {
            applied: false,
            error: `No event found for id ${eventId}. Find ids with search_berkeley_events, or pass event null to close the panel.`,
          };
        }
      }

      // Merge read the URL before the feed loaded. A visitor may have
      // changed the page since, and applying the old state would undo it.
      if (fromCurrent && deps.getLocationSearch() !== locationSearch) {
        return {
          applied: false,
          error:
            "The page URL changed while apply_ui_state ran. Call get_ui_state, then retry.",
        };
      }

      // A date the agent chose, or one the user already pinned, stays in the
      // URL so a date implied by the query cannot override it.
      const search = buildUrlStateSearch(filters, eventId, {
        defaultFilters: DEFAULT_FILTERS,
        explicitDateRange: inputHasDate(input) || current.hasExplicitDateRange,
      });
      deps.applyUrlSearch(search);
      return {
        applied: true,
        mode,
        reset: input.reset === true,
        search,
        url: absoluteUrl(search || ""),
        filters,
        selectedEventId: eventId,
      };
    },
  };

  const listFilterOptions: WebMcpTool = {
    name: "list_filter_options",
    description:
      'List the values the filter inputs accept: categories, active sources with labels, date presets, and published topics (slug, label, group). Pass these to search_berkeley_events, build_calevents_url and apply_ui_state. "All" clears a category or source filter.',
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    execute: async function executeListFilterOptions() {
      const data = await fetchEventsPayload();
      const topics = Array.isArray(data.topic_vocabulary?.topics)
        ? data.topic_vocabulary.topics
            .filter(
              (topic) =>
                typeof topic?.slug === "string" &&
                typeof topic.label === "string",
            )
            .map((topic) => ({
              slug: topic.slug,
              label: topic.label,
              group: topic.group,
            }))
        : [];

      return {
        lastUpdated: data.lastUpdated,
        categories: SEARCH_CATEGORIES,
        sources: ACTIVE_SOURCES.map((id) => ({
          id,
          label: SOURCE_LABELS[id] ?? id,
        })),
        datePresets: DATE_PRESETS.map((preset) => ({ ...preset })),
        defaultDatePreset: DEFAULT_FILTERS.dateRange,
        topics,
      };
    },
  };

  const getEventDirections: WebMcpTool = {
    name: "get_event_directions",
    description:
      "Return a Google Maps directions/search URL for an event location, or null for online/empty locations.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Event id." },
        location: {
          type: "string",
          description: "Optional raw location text when id is unknown.",
        },
      },
    },
    annotations: { readOnlyHint: true },
    execute: async function executeDirections(input) {
      input = input ?? {};
      if (typeof input.location === "string" && input.location.trim()) {
        return {
          directionsUrl: getDirectionsUrl(input.location.trim()),
          location: input.location.trim(),
        };
      }

      if (!input.id || typeof input.id !== "string") {
        return {
          error: "id or location is required",
          directionsUrl: null,
        };
      }

      const data = await fetchEventsPayload();
      const event = findEventById(
        Array.isArray(data.events) ? data.events : [],
        input.id,
      );
      if (!event) {
        return {
          error: `no event found for id ${input.id}`,
          directionsUrl: null,
        };
      }

      return {
        id: event.id,
        location: event.location,
        directionsUrl: getDirectionsUrl(event.location),
      };
    },
  };

  return [
    searchBerkeleyEvents,
    getEventById,
    generateEventIcs,
    feedStatus,
    getUiState,
    buildCaleventsUrl,
    applyUiState,
    getEventDirections,
    listFilterOptions,
  ];
}
