import { useCallback, useEffect, useMemo, useState } from "react";

import { ALL_SOURCES, SOURCE_LABELS } from "../appConfig";
import type { SourceOption } from "../appConfig";
import { fetchEventsFromGemini } from "../services/geminiService";
import { CalEvent, IngestionStatus, LoadingState } from "../types";
import type { SearchIndex } from "../utils/textUtils";

interface EventFeedState {
  allEvents: CalEvent[];
  lastUpdated: number | null;
  loading: LoadingState;
  statusReport: IngestionStatus | null;
  searchIndex: SearchIndex | null;
  sourceOptions: SourceOption[];
  sourceCount: number;
  loadEvents: () => Promise<void>;
}

export function useEventFeed(): EventFeedState {
  const [allEvents, setAllEvents] = useState<CalEvent[]>([]);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [loading, setLoading] = useState<LoadingState>(LoadingState.IDLE);
  const [statusReport, setStatusReport] = useState<IngestionStatus | null>(
    null,
  );
  const [searchIndex, setSearchIndex] = useState<SearchIndex | null>(null);

  const loadEvents = useCallback(async () => {
    setLoading(LoadingState.LOADING);
    setStatusReport(null);

    try {
      const results = await Promise.all([
        fetchEventsFromGemini(),
        fetch("/search-index.json")
          .then((response) => (response.ok ? response.json() : null))
          .then((index: SearchIndex | null) => {
            if (index) {
              setSearchIndex(index);
            }
          })
          .catch(() => {
            // Search index generation is optional; fall back to text-only search.
          }),
      ]).catch((error: unknown) => {
        console.error(error);
        setLoading(LoadingState.ERROR);
        return null;
      });

      if (!results) {
        return;
      }

      const [data] = results;
      setAllEvents(data.events);
      setLastUpdated(data.lastUpdated);
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
    loading,
    statusReport,
    searchIndex,
    sourceOptions,
    sourceCount: Math.max(sourceOptions.length - 1, 0),
    loadEvents,
  };
}
