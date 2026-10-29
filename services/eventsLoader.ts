import { SearchResponse } from "../types";

/**
 * Loads the pre-generated static artifacts published by scripts/updateEvents.ts.
 * The page reads only `public/events.json`. `public/status.json` is for
 * operators and agents, so visitors never see pipeline health.
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

export const fetchEventArtifacts = async (
  _forceRefresh: boolean = false,
): Promise<SearchResponse & { lastUpdated: number }> => {
  try {
    const data = await fetchJson<EventsPayload>("/events.json");
    if (!Array.isArray(data.events)) {
      throw new Error("Invalid events payload: events must be an array");
    }

    return {
      events: data.events,
      sources: Array.isArray(data.sources) ? data.sources : [],
      topic_vocabulary: data.topic_vocabulary,
      lastUpdated: data.lastUpdated ?? 0,
    };
  } catch (error) {
    console.error("Error loading events:", error);
    throw error;
  }
};
