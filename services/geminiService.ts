import { IngestionStatus, SearchResponse } from "../types";

/**
 * Loads the pre-generated static artifacts published by scripts/updateEvents.ts.
 *
 * This module keeps the legacy `fetchEventsFromGemini` name for compatibility
 * with App.tsx, but it does not call Gemini at runtime. The browser only reads
 * `public/events.json` and `public/status.json`.
 */
type EventsPayload = SearchResponse & { lastUpdated?: number };

async function fetchJson<T>(path: string, timeoutMs = 8000): Promise<T> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(path, {
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Failed to load ${path}: ${response.status}`);
    }

    return response.json() as Promise<T>;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export const fetchStaticArtifacts = async (
  _forceRefresh: boolean = false,
): Promise<
  SearchResponse & { lastUpdated: number; status?: IngestionStatus }
> => {
  try {
    const [eventsResult, statusResult] = await Promise.allSettled([
      fetchJson<EventsPayload>("/events.json"),
      fetchJson<IngestionStatus>("/status.json"),
    ]);

    if (eventsResult.status === "rejected") {
      throw eventsResult.reason;
    }

    const data = eventsResult.value;
    if (!Array.isArray(data.events)) {
      throw new Error("Invalid events payload: events must be an array");
    }

    return {
      events: data.events,
      sources: Array.isArray(data.sources) ? data.sources : [],
      lastUpdated: data.lastUpdated ?? 0,
      data_age_hours:
        typeof data.data_age_hours === "number" ? data.data_age_hours : 0,
      degraded_sources: Array.isArray(data.degraded_sources)
        ? data.degraded_sources.map(String)
        : [],
      status:
        statusResult.status === "fulfilled" ? statusResult.value : undefined,
    };
  } catch (error) {
    console.error("Error loading events:", error);
    throw error;
  }
};

export const fetchEventsFromGemini = fetchStaticArtifacts;
