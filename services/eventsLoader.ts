import { IngestionStatus, SearchResponse } from "../types";
import { captureError } from "../utils/errorTracking";

/**
 * Loads the pre-generated static artifacts published by scripts/updateEvents.ts.
 * The browser only reads `public/events.json` and `public/status.json`.
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

    // status.json drives the StatusBanner / StaleDataBanner. Silently dropping
    // a fetch failure means degraded states never reach the UI, so log it and
    // report through errorTracking even though events.json is the only hard
    // requirement for the page to render.
    let status: IngestionStatus | undefined;
    if (statusResult.status === "fulfilled") {
      status = statusResult.value;
    } else {
      console.warn(
        "[eventsLoader] status.json fetch failed",
        statusResult.reason,
      );
      captureError(statusResult.reason, { source: "status.json" });
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
      status,
    };
  } catch (error) {
    console.error("Error loading events:", error);
    throw error;
  }
};
