import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ALL_SOURCES, SOURCE_LABELS } from "../appConfig";
import type { SourceOption } from "../appConfig";
import { fetchEventArtifacts } from "../services/eventsLoader";
import {
  CalEvent,
  IngestionStatus,
  LoadingState,
  type TopicVocabulary,
} from "../types";
import type { SearchIndex } from "../utils/textUtils";

interface EventFeedState {
  allEvents: CalEvent[];
  lastUpdated: number | null;
  dataAgeHours: number;
  degradedSources: string[];
  loading: LoadingState;
  statusReport: IngestionStatus | null;
  searchIndex: SearchIndex | null;
  topicVocabulary: TopicVocabulary | null;
  sourceOptions: SourceOption[];
  sourceCount: number;
  loadEvents: () => Promise<void>;
}

// The index is about 180 KB gzipped. A slow phone link needs more than a
// few seconds, and Fuse-only search caps hits and ignores field weights.
const SEARCH_INDEX_TIMEOUT_MS = 10_000;

async function fetchOptionalSearchIndex(
  timeoutMs = SEARCH_INDEX_TIMEOUT_MS,
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

/**
 * Loads the published feed. `needsSearchIndex` is true once the visitor has
 * typed a query of two or more characters. A failed index load then gets one
 * more try.
 */
export function useEventFeed(needsSearchIndex = false): EventFeedState {
  const [allEvents, setAllEvents] = useState<CalEvent[]>([]);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [dataAgeHours, setDataAgeHours] = useState(0);
  const [degradedSources, setDegradedSources] = useState<string[]>([]);
  const [loading, setLoading] = useState<LoadingState>(LoadingState.IDLE);
  const [statusReport, setStatusReport] = useState<IngestionStatus | null>(
    null,
  );
  const [searchIndex, setSearchIndex] = useState<SearchIndex | null>(null);
  const [topicVocabulary, setTopicVocabulary] =
    useState<TopicVocabulary | null>(null);
  // Id of the index request that failed last, or 0. An id rather than a
  // flag, so a failure after a reload still reaches the retry effect.
  const [failedIndexRequest, setFailedIndexRequest] = useState(0);
  const searchIndexRequest = useRef(0);
  const searchIndexRetried = useRef(false);

  const loadSearchIndex = useCallback(() => {
    const request = ++searchIndexRequest.current;
    void fetchOptionalSearchIndex().then((index) => {
      // A reload or retry that started later owns the result.
      if (request !== searchIndexRequest.current) return;
      // Set unconditionally (even on null) so a reload whose index fetch
      // fails clears the now-stale index rather than serving old postings.
      setSearchIndex(index);
      setFailedIndexRequest(index === null ? request : 0);
    });
  }, []);

  const loadEvents = useCallback(async () => {
    setLoading(LoadingState.LOADING);
    setStatusReport(null);

    let data: Awaited<ReturnType<typeof fetchEventArtifacts>>;
    try {
      data = await fetchEventArtifacts();
      assertValidEventsPayload(data);
    } catch (error) {
      console.error(error);
      setLoading(LoadingState.ERROR);
      return;
    }

    // Render the list as soon as events.json resolves. First paint must not
    // wait on the search index, which is only needed once a query reaches 2+
    // characters.
    setAllEvents(data.events);
    setTopicVocabulary(data.topic_vocabulary ?? null);
    setLastUpdated(data.lastUpdated ?? null);
    setDataAgeHours(
      typeof data.data_age_hours === "number" ? data.data_age_hours : 0,
    );
    setDegradedSources(
      Array.isArray(data.degraded_sources) ? data.degraded_sources : [],
    );
    setStatusReport(data.status || null);
    setLoading(LoadingState.SUCCESS);

    searchIndexRetried.current = false;
    loadSearchIndex();
  }, [loadSearchIndex]);

  useEffect(() => {
    if (
      !needsSearchIndex ||
      !failedIndexRequest ||
      searchIndexRetried.current
    ) {
      return;
    }
    searchIndexRetried.current = true;
    loadSearchIndex();
  }, [needsSearchIndex, failedIndexRequest, loadSearchIndex]);

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
    topicVocabulary,
    sourceOptions,
    sourceCount: Math.max(sourceOptions.length - 1, 0),
    loadEvents,
  };
}
