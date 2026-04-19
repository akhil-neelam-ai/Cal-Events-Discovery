import { IngestionStatus, SearchResponse } from "../types";

/**
 * Fetches pre-generated events and the latest status metadata from static JSON.
 * The data is updated separately by scripts/updateEvents.ts.
 */
type EventsPayload = SearchResponse & { lastUpdated?: number };

async function fetchJson<T>(path: string, timeoutMs = 8000): Promise<T> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(path, {
      cache: 'no-cache',
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

export const fetchEventsFromGemini = async (_forceRefresh: boolean = false): Promise<SearchResponse & { lastUpdated: number; status?: IngestionStatus }> => {
  try {
    const [eventsResult, statusResult] = await Promise.allSettled([
      fetchJson<EventsPayload>('/events.json'),
      fetchJson<IngestionStatus>('/status.json'),
    ]);

    if (eventsResult.status === 'rejected') {
      throw eventsResult.reason;
    }

    const data = eventsResult.value;

    return {
      events: data.events || [],
      sources: data.sources || [],
      lastUpdated: data.lastUpdated || Date.now(),
      status: statusResult.status === 'fulfilled' ? statusResult.value : undefined,
    };
  } catch (error) {
    console.error('Error loading events:', error);
    throw error;
  }
};
