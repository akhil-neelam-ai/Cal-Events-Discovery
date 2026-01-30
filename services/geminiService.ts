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

    // Post-process: Fix Cal Athletics event URLs
    const CALBEARS_TICKETS_URL = 'https://calbears.com/sports/2021/2/23/cal-golden-bears-tickets.aspx';
    const events = (data.events || []).map((event: CalEvent) => {
      // Only replace URL for official Cal Athletics events
      const isCalAthleticsEvent =
        event.organizer.toLowerCase().includes('cal athletics') ||
        event.organizer.toLowerCase().includes('cal bears') ||
        event.organizer.toLowerCase().includes('athletics department') ||
        event.title.toLowerCase().includes('cal bears') ||
        (event.url && event.url.includes('calbears.com'));

      if (isCalAthleticsEvent) {
        return { ...event, url: CALBEARS_TICKETS_URL };
      }
      return event;
    });

    return {
      events,
      sources: data.sources || [],
      lastUpdated: data.lastUpdated || Date.now()
    };
  } catch (error) {
    console.error("Error loading events:", error);
    throw error;
  }
};
