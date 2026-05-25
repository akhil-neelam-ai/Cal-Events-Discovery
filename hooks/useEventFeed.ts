import { useCallback, useEffect, useMemo, useState } from "react";

import { ALL_SOURCES, SOURCE_LABELS } from "../appConfig";
import type { SourceOption } from "../appConfig";
import { fetchEventArtifacts } from "../services/eventsLoader";
import { CalEvent, IngestionStatus, LoadingState } from "../types";
import type { SearchIndex } from "../utils/textUtils";

interface EventFeedState {
  allEvents: CalEvent[];
  lastUpdated: number | null;
  dataAgeHours: number;
  degradedSources: string[];
  loading: LoadingState;
  statusReport: IngestionStatus | null;
  searchIndex: SearchIndex | null;
  sourceOptions: SourceOption[];
  sourceCount: number;
  loadEvents: () => Promise<void>;
}

async function fetchOptionalSearchIndex(
  timeoutMs = 3000,
): Promise<SearchIndex | null> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch("/search-index.json", {
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as SearchIndex;
  } catch {
    // Search index generation is optional; fall back to text-only search.
    return null;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function assertValidEventsPayload(
  data: Awaited<ReturnType<typeof fetchEventArtifacts>>,
): void {
  if (!Array.isArray(data.events)) {
    throw new Error("Invalid events payload: events must be an array");
  }
}

export function useEventFeed(): EventFeedState {
  const [allEvents, setAllEvents] = useState<CalEvent[]>([]);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [dataAgeHours, setDataAgeHours] = useState(0);
  const [degradedSources, setDegradedSources] = useState<string[]>([]);
  const [loading, setLoading] = useState<LoadingState>(LoadingState.IDLE);
  const [statusReport, setStatusReport] = useState<IngestionStatus | null>(
    null,
  );
  const [searchIndex, setSearchIndex] = useState<SearchIndex | null>(null);

  const loadEvents = useCallback(async () => {
    setLoading(LoadingState.LOADING);
    setStatusReport(null);

    try {
      const [data, nextSearchIndex] = await Promise.all([
        fetchEventArtifacts(),
        fetchOptionalSearchIndex(),
      ]);

      assertValidEventsPayload(data);
      setSearchIndex(nextSearchIndex);
      setAllEvents(data.events);
      setLastUpdated(data.lastUpdated ?? null);
      setDataAgeHours(
        typeof data.data_age_hours === "number" ? data.data_age_hours : 0,
      );
      setDegradedSources(
        Array.isArray(data.degraded_sources) ? data.degraded_sources : [],
      );
      setStatusReport(data.status || null);
      setLoading(LoadingState.SUCCESS);
    } catch (error) {
      console.error(error);
      setLoading(LoadingState.ERROR);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadEvents();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [loadEvents]);

  const sourceOptions = useMemo<SourceOption[]>(() => {
    const counts = new Map<string, number>();
    for (const event of allEvents) {
      if (!event.source) {
        continue;
      }
      counts.set(event.source, (counts.get(event.source) ?? 0) + 1);
    }

    const options: SourceOption[] = [
      { value: "All", label: "All", count: allEvents.length },
    ];
    for (const source of ALL_SOURCES) {
      if (source === "All") {
        continue;
      }

      const count = counts.get(source) ?? 0;
      if (count === 0) {
        continue;
      }

      options.push({
        value: source,
        label: SOURCE_LABELS[source] || source,
        count,
      });
    }

    return options;
  }, [allEvents]);

  return {
    allEvents,
    lastUpdated,
    dataAgeHours,
    degradedSources,
    loading,
    statusReport,
    searchIndex,
    sourceOptions,
    sourceCount: Math.max(sourceOptions.length - 1, 0),
    loadEvents,
  };
}
