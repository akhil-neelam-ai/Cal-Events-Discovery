import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useEventFeed } from "../hooks/useEventFeed";
import { fetchEventsFromGemini } from "../services/geminiService";
import { LoadingState } from "../types";
import type { CalEvent } from "../types";
import type { SearchIndex } from "../utils/textUtils";

vi.mock("../services/geminiService", () => ({
  fetchEventsFromGemini: vi.fn(),
}));

const fetchEventsFromGeminiMock = vi.mocked(fetchEventsFromGemini);

function makeEvent(overrides: Partial<CalEvent> = {}): CalEvent {
  const id = overrides.id ?? "event-1";

  return {
    id,
    title: overrides.title ?? "Campus Talk",
    organizer: overrides.organizer ?? "Berkeley Events",
    date: overrides.date ?? "2026-04-22",
    time: overrides.time ?? "5:00 PM",
    location: overrides.location ?? "Soda Hall",
    description: overrides.description ?? "A campus event.",
    tags: overrides.tags ?? ["Academic"],
    url: overrides.url ?? `https://example.com/${id}`,
    source: overrides.source ?? "livewhale",
  };
}

function makeSearchIndex(): SearchIndex {
  return {
    ids: ["event-1"],
    t: {},
    g: {},
    o: {},
    d: {},
    l: {},
    buildAt: "2026-04-22T19:00:00.000Z",
    eventCount: 1,
  };
}

function makeJsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

function EventFeedProbe() {
  const { allEvents, loading, searchIndex, loadEvents } = useEventFeed();

  return (
    <div>
      <output aria-label="loading">{loading}</output>
      <output aria-label="event-count">{allEvents.length}</output>
      <output aria-label="search-index">
        {searchIndex ? "loaded" : "missing"}
      </output>
      <button type="button" onClick={() => void loadEvents()}>
        Reload
      </button>
    </div>
  );
}

describe("useEventFeed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads events successfully when the optional search index fails", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockRejectedValue(new Error("search index unavailable"));
    vi.stubGlobal("fetch", fetchMock);

    fetchEventsFromGeminiMock.mockResolvedValue({
      events: [makeEvent()],
      sources: [],
      lastUpdated: Date.parse("2026-04-22T19:00:00.000Z"),
    });

    render(<EventFeedProbe />);

    await waitFor(() => {
      expect(screen.getByLabelText("loading")).toHaveTextContent(
        LoadingState.SUCCESS,
      );
    });

    expect(screen.getByLabelText("event-count")).toHaveTextContent("1");
    expect(screen.getByLabelText("search-index")).toHaveTextContent("missing");
    expect(fetchMock).toHaveBeenCalledWith(
      "/search-index.json",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("enters the error state when the events payload fails", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(makeJsonResponse(makeSearchIndex()));
    vi.stubGlobal("fetch", fetchMock);

    fetchEventsFromGeminiMock.mockRejectedValue(
      new Error("events unavailable"),
    );

    render(<EventFeedProbe />);

    await waitFor(() => {
      expect(screen.getByLabelText("loading")).toHaveTextContent(
        LoadingState.ERROR,
      );
    });

    expect(screen.getByLabelText("event-count")).toHaveTextContent("0");
  });

  it("enters the error state when the events payload is malformed", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(makeJsonResponse(makeSearchIndex()));
    vi.stubGlobal("fetch", fetchMock);

    fetchEventsFromGeminiMock.mockResolvedValue({
      events: undefined,
      sources: [],
      lastUpdated: Date.parse("2026-04-22T19:00:00.000Z"),
    } as unknown as Awaited<ReturnType<typeof fetchEventsFromGemini>>);

    render(<EventFeedProbe />);

    await waitFor(() => {
      expect(screen.getByLabelText("loading")).toHaveTextContent(
        LoadingState.ERROR,
      );
    });

    expect(screen.getByLabelText("event-count")).toHaveTextContent("0");
  });

  it("clears a stale search index when a later optional index fetch fails", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(makeJsonResponse(makeSearchIndex()))
      .mockRejectedValueOnce(new Error("search index unavailable"));
    vi.stubGlobal("fetch", fetchMock);

    fetchEventsFromGeminiMock
      .mockResolvedValueOnce({
        events: [makeEvent()],
        sources: [],
        lastUpdated: Date.parse("2026-04-22T19:00:00.000Z"),
      })
      .mockResolvedValueOnce({
        events: [makeEvent({ id: "event-2" })],
        sources: [],
        lastUpdated: Date.parse("2026-04-23T19:00:00.000Z"),
      });

    render(<EventFeedProbe />);

    await waitFor(() => {
      expect(screen.getByLabelText("search-index")).toHaveTextContent("loaded");
    });

    fireEvent.click(screen.getByRole("button", { name: "Reload" }));

    await waitFor(() => {
      expect(screen.getByLabelText("search-index")).toHaveTextContent(
        "missing",
      );
    });
    expect(screen.getByLabelText("event-count")).toHaveTextContent("1");
  });
});
