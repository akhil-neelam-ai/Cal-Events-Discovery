import { ALL_SOURCES, Categories, DEFAULT_FILTERS } from "../appConfig";
import type { CalEvent, SearchFilters, SearchResponse } from "../types";
import {
  addDaysToDateKey,
  getCurrentPacificDateKey,
  getPacificDateKey,
  sortEventsChronologically,
} from "../utils/eventDates";
import { getDirectionsUrl } from "../utils/eventPresentation";
import { buildEventIcs, buildGoogleCalendarUrl } from "../utils/icsExport";
import { searchEvents } from "../utils/searchEngine";
import type { SearchIndex } from "../utils/textUtils";
import { buildUrlStateSearch, parseUrlState } from "../utils/urlState";

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

function findEventById(events: CalEvent[], id: string): CalEvent | null {
  return events.find((event) => event.id === id) ?? null;
}

function summarizeEvent(event: CalEvent) {
  return {
    id: event.id,
    title: event.title,
    date: event.date,
    time: event.time,
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

function resolveDatePreset(
  preset: unknown,
): { startDate: string; endDate?: string } | null {
  if (
    preset !== "today" &&
    preset !== "tomorrow" &&
    preset !== "week" &&
    preset !== "upcoming"
  ) {
    return null;
  }

  const todayKey = getCurrentPacificDateKey();
  if (preset === "today") {
    return { startDate: todayKey, endDate: todayKey };
  }
  if (preset === "tomorrow") {
    const tomorrow = addDaysToDateKey(todayKey, 1);
    return { startDate: tomorrow, endDate: tomorrow };
  }
  if (preset === "week") {
    return { startDate: todayKey, endDate: addDaysToDateKey(todayKey, 6) };
  }
  return { startDate: todayKey };
}

function buildFiltersFromInput(
  input: Record<string, unknown>,
  allowedTopics: readonly string[] = [],
): SearchFilters {
  const datePreset =
    typeof input.date === "string"
      ? input.date
      : typeof input.datePreset === "string"
        ? input.datePreset
        : undefined;

  const dateRange =
    datePreset === "today" ||
    datePreset === "tomorrow" ||
    datePreset === "week" ||
    datePreset === "upcoming"
      ? datePreset
      : DEFAULT_FILTERS.dateRange;

  const category =
    typeof input.category === "string" && input.category.trim()
      ? input.category.trim()
      : DEFAULT_FILTERS.category;

  const source =
    typeof input.source === "string" && input.source.trim()
      ? input.source.trim()
      : DEFAULT_FILTERS.source;

  const searchQuery =
    typeof input.q === "string"
      ? input.q
      : typeof input.query === "string"
        ? input.query
        : DEFAULT_FILTERS.searchQuery;

  const topic =
    typeof input.topic === "string" && input.topic.trim()
      ? input.topic.trim()
      : DEFAULT_FILTERS.topic;

  return {
    dateRange,
    category: Categories.includes(category)
      ? category
      : DEFAULT_FILTERS.category,
    topic: allowedTopics.includes(topic) ? topic : DEFAULT_FILTERS.topic,
    source: ALL_SOURCES.includes(source) ? source : DEFAULT_FILTERS.source,
    searchQuery: String(searchQuery ?? "").trim(),
  };
}

function getPublishedTopicSlugs(payload: EventsPayload): string[] {
  return Array.isArray(payload.topic_vocabulary?.topics)
    ? payload.topic_vocabulary.topics
        .map((topic) => topic.slug)
        .filter((slug) => typeof slug === "string")
    : [];
}

function validateTopic(
  input: Record<string, unknown>,
  allowedTopics: readonly string[],
): string | null {
  if (typeof input.topic !== "string" || !input.topic.trim()) return null;
  const topic = input.topic.trim();
  if (!allowedTopics.includes(topic)) {
    throw new Error(
      `Unknown topic "${topic}". Use a slug from events.json.topic_vocabulary.topics.`,
    );
  }
  return topic;
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
      "Search upcoming UC Berkeley campus events using the same ranked relevance engine as the CalEvents UI (search-index tokens, synonym expansion, intent chips, fuzzy fallback). Optional category/source/date filters match the UI. Prefer this for discovery; use get_event_by_id for a single known id.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Natural-language or keyword query. Uses the website ranked search path when length is at least 2 characters.",
        },
        datePreset: {
          type: "string",
          enum: ["today", "tomorrow", "week", "upcoming"],
          description:
            "Optional Pacific-time date bucket. Explicit startDate/endDate override the matching bound.",
        },
        category: {
          type: "string",
          enum: [
            "Academic",
            "Arts",
            "Sports",
            "Science & Tech",
            "Student Life",
            "Entrepreneurship",
          ],
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
          description:
            "Optional source id: livewhale, callink, cal_performances, calbears, bampfa, haas, berkeley_law, simons, luma, begin, ai_risk, or brsl.",
        },
        startDate: {
          type: "string",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
          description:
            "Optional inclusive Pacific date lower bound in YYYY-MM-DD.",
        },
        endDate: {
          type: "string",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
          description:
            "Optional inclusive Pacific date upper bound in YYYY-MM-DD.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          default: 10,
        },
      },
    },
    annotations: { readOnlyHint: true },
    execute: async function executeSearchEvents(input) {
      input = input ?? {};

      const preset = resolveDatePreset(input.datePreset);
      const startDate =
        typeof input.startDate === "string"
          ? input.startDate
          : (preset?.startDate ?? undefined);
      const endDate =
        typeof input.endDate === "string"
          ? input.endDate
          : (preset?.endDate ?? undefined);

      if (startDate && endDate && startDate > endDate) {
        return {
          error: "startDate must be earlier than or equal to endDate",
          count: 0,
          events: [],
        };
      }

      const [data, index] = await Promise.all([
        fetchEventsPayload(),
        fetchSearchIndex(),
      ]);
      const allEvents = Array.isArray(data.events) ? data.events : [];
      const allowedTopics = getPublishedTopicSlugs(data);
      let topic: string | null;
      try {
        topic = validateTopic(input, allowedTopics);
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : "invalid topic",
          count: 0,
          events: [],
        };
      }
      const category =
        typeof input.category === "string" ? input.category.trim() : "";
      const source =
        typeof input.source === "string" ? input.source.trim() : "";
      const query = typeof input.query === "string" ? input.query.trim() : "";

      const pool = allEvents.filter((event) => {
        const primaryCategory = event.tags?.[0]?.toLowerCase() ?? "";
        const matchesCategory =
          !category || primaryCategory === category.toLowerCase();
        const matchesSource = !source || event.source === source;
        const matchesTopic =
          !topic || (event.topics ?? []).some((slug) => slug === topic);
        return matchesCategory && matchesSource && matchesTopic;
      });

      let ranked: CalEvent[];
      let fallbackUsed = false;
      if (query.length < 2) {
        ranked = sortEventsChronologically(pool);
      } else {
        const output = searchEvents(pool, query, index);
        ranked = output.results;
        fallbackUsed = output.fallbackUsed;
        // Older published fixtures may predate topic_vocabulary. Preserve
        // their ranked-search behavior until the next feed publish.
        if (ranked.length === 0 && allowedTopics.length === 0) {
          const needle = query.toLowerCase();
          ranked = sortEventsChronologically(
            pool.filter((event) =>
              `${event.title} ${event.description}`
                .toLowerCase()
                .includes(needle),
            ),
          );
        }
      }

      const todayKey = getCurrentPacificDateKey();
      const limit = parseLimit(input.limit);
      const results = ranked
        .filter((event) => {
          const key = getPacificDateKey(event.date);
          if (!key) return false;
          if (startDate && key < startDate) return false;
          if (endDate && key > endDate) return false;
          return true;
        })
        .slice(0, limit)
        .map(summarizeEvent);

      return {
        lastUpdated: data.lastUpdated,
        count: results.length,
        fallbackUsed,
        ranked: query.length >= 2,
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
      "Read the current CalEvents UI workspace from the browser URL: filters (q/date/category/source), selected event id, and optional feed freshness from status.json.",
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
      const urlState = parseUrlState(deps.getLocationSearch(), {
        defaultFilters: DEFAULT_FILTERS,
        allowedCategories: Categories,
        allowedSources: ALL_SOURCES,
        allowedTopics: getPublishedTopicSlugs(await fetchEventsPayload()),
      });

      const result: Record<string, unknown> = {
        filters: urlState.filters,
        selectedEventId: urlState.selectedEventId,
        hasExplicitDateRange: urlState.hasExplicitDateRange,
        url: absoluteUrl(deps.getLocationSearch() || ""),
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
      "Build a CalEvents deep-link URL from query/date/category/source/event without changing the open page. Query params: q, date, category, source, event.",
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
          enum: ["today", "tomorrow", "week", "upcoming"],
          description: "Date bucket (?date=).",
        },
        datePreset: {
          type: "string",
          enum: ["today", "tomorrow", "week", "upcoming"],
          description: "Alias for date.",
        },
        category: {
          type: "string",
          description: 'Category or "All".',
        },
        source: {
          type: "string",
          description: 'Source id or "All".',
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
      const data = await fetchEventsPayload();
      const allowedTopics = getPublishedTopicSlugs(data);
      try {
        validateTopic(input, allowedTopics);
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : "invalid topic",
        };
      }
      const filters = buildFiltersFromInput(input, allowedTopics);
      const eventId =
        typeof input.event === "string" && input.event.trim()
          ? input.event.trim()
          : null;
      const search = buildUrlStateSearch(filters, eventId, {
        defaultFilters: DEFAULT_FILTERS,
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
      "Update the open CalEvents page to match shared URL workspace state (q/date/category/source/event). The React UI syncs via history + popstate.",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string" },
        query: { type: "string" },
        date: {
          type: "string",
          enum: ["today", "tomorrow", "week", "upcoming"],
        },
        datePreset: {
          type: "string",
          enum: ["today", "tomorrow", "week", "upcoming"],
        },
        category: { type: "string" },
        source: { type: "string" },
        topic: {
          type: "string",
          description:
            "Published topic slug from events.json.topic_vocabulary.",
        },
        event: { type: "string" },
      },
    },
    annotations: { readOnlyHint: false },
    execute: async function executeApplyUiState(input) {
      input = input ?? {};
      const data = await fetchEventsPayload();
      const allowedTopics = getPublishedTopicSlugs(data);
      try {
        validateTopic(input, allowedTopics);
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : "invalid topic",
        };
      }
      const filters = buildFiltersFromInput(input, allowedTopics);
      const eventId =
        typeof input.event === "string" && input.event.trim()
          ? input.event.trim()
          : null;
      const search = buildUrlStateSearch(filters, eventId, {
        defaultFilters: DEFAULT_FILTERS,
      });
      deps.applyUrlSearch(search);
      return {
        applied: true,
        search,
        url: absoluteUrl(search || ""),
        filters,
        selectedEventId: eventId,
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
  ];
}
