import { CalEvent, SearchResponse, GroundingSource } from "../types";

/**
 * Fetches pre-generated events from the static events.json file.
 * Events are updated separately via the scripts/updateEvents.ts script.
 */
export const fetchEventsFromGemini = async (_forceRefresh: boolean = false): Promise<SearchResponse & { lastUpdated: number }> => {
  try {
    const response = await fetch('/events.json', {
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(`Failed to load events: ${response.status}`);
    }

    const data = await response.json();

    return {
      events: data.events || [],
      sources: data.sources || [],
      lastUpdated: data.lastUpdated || Date.now()
    };
  } catch (error) {
    console.error("Error loading events:", error);
    throw error;
  }
};
