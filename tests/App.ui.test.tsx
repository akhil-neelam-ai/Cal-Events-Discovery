import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App from "../App";
import type { CalEvent } from "../types";
import { LoadingState } from "../types";

const TODAY_KEY = "2026-04-22";
const TOMORROW_KEY = "2026-04-23";
const NEXT_WEEK_KEY = "2026-04-29";

type MockFeedState = {
  allEvents: CalEvent[];
  lastUpdated: number | null;
  loading: LoadingState;
  statusReport: null;
  searchIndex: null;
  sourceOptions: Array<{ value: string; label: string; count: number }>;
  sourceCount: number;
  loadEvents: ReturnType<typeof vi.fn>;
};

let mockFeedState: MockFeedState;

vi.mock("@vercel/analytics/react", () => ({
  Analytics: () => null,
}));

vi.mock("../utils/analytics", () => ({
  initGA: vi.fn(),
  trackPageView: vi.fn(),
  trackSearch: vi.fn(),
  trackCategoryFilter: vi.fn(),
  trackDateFilter: vi.fn(),
  trackEventClick: vi.fn(),
  trackFilter: vi.fn(),
  trackExternalLink: vi.fn(),
}));

vi.mock("../hooks/useEventFeed", () => ({
  useEventFeed: () => mockFeedState,
}));

vi.mock("../hooks/useIsMobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("../hooks/usePacificDateKeys", () => ({
  usePacificDateKeys: () => ({
    todayKey: TODAY_KEY,
    tomorrowKey: TOMORROW_KEY,
    nextWeekKey: NEXT_WEEK_KEY,
  }),
}));

vi.mock("../hooks/useBackToTopVisibility", () => ({
  useBackToTopVisibility: () => false,
}));

vi.mock("../hooks/usePrefersReducedMotion", () => ({
  usePrefersReducedMotion: () => true,
}));

function buildSourceOptions(events: CalEvent[]) {
  const counts = new Map<string, number>();

  for (const event of events) {
    if (!event.source) {
      continue;
    }

    counts.set(event.source, (counts.get(event.source) ?? 0) + 1);
  }

  return [
    { value: "All", label: "All", count: events.length },
    ...Array.from(counts.entries()).map(([value, count]) => ({
      value,
      label: value,
      count,
    })),
  ];
}

function makeEvent(overrides: Partial<CalEvent> = {}): CalEvent {
  const id = overrides.id ?? "event-1";

  return {
    id,
    title: overrides.title ?? "AI Seminar",
    organizer: overrides.organizer ?? "Berkeley AI Lab",
    date: overrides.date ?? TODAY_KEY,
    time: overrides.time ?? "5:00 PM",
    location: overrides.location ?? "Soda Hall",
    description: overrides.description ?? "A Berkeley event about AI.",
    tags: overrides.tags ?? ["Science & Tech"],
    url: overrides.url ?? `https://example.com/${id}`,
    source: overrides.source ?? "livewhale",
  };
}

function makeFeedState(events: CalEvent[]): MockFeedState {
  return {
    allEvents: events,
    lastUpdated: Date.parse("2026-04-22T19:00:00Z"),
    loading: LoadingState.SUCCESS,
    statusReport: null,
    searchIndex: null,
    sourceOptions: buildSourceOptions(events),
    sourceCount: Math.max(
      new Set(events.map((event) => event.source).filter(Boolean)).size,
      0,
    ),
    loadEvents: vi.fn().mockResolvedValue(undefined),
  };
}

describe("App UI regressions", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    window.sessionStorage.clear();
    mockFeedState = makeFeedState([]);
  });

  it("restores shareable search and filter state from the URL", () => {
    mockFeedState = makeFeedState([
      makeEvent({
        id: "week-ai",
        title: "AI Research Forum",
        date: TOMORROW_KEY,
        description: "AI research talks for Berkeley students.",
      }),
    ]);

    window.history.replaceState(
      {},
      "",
      "/?q=ai&category=Science%20%26%20Tech&date=week",
    );

    render(<App />);

    expect(
      screen.getByRole("textbox", { name: /search campus events/i }),
    ).toHaveValue("ai");
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: /science & tech · this week/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("AI Research Forum")).toBeInTheDocument();
  });

  it("falls back from today to this week when today has no events", () => {
    mockFeedState = makeFeedState([
      makeEvent({
        id: "tomorrow-event",
        title: "Tomorrow Founder Talk",
        date: TOMORROW_KEY,
        tags: ["Entrepreneurship"],
        description: "A founder talk happening tomorrow.",
      }),
    ]);

    render(<App />);

    expect(
      screen.getByText("Nothing today — showing this week instead."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: /this week/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Tomorrow Founder Talk")).toBeInTheDocument();
  });

  it("lets users dismiss interpreted campus-area chips and broadens results", async () => {
    const user = userEvent.setup();

    mockFeedState = makeFeedState([
      makeEvent({
        id: "northside-talk",
        title: "Northside Talk",
        location: "Hearst Mining Circle",
        description: "A northside talk for Berkeley students.",
      }),
      makeEvent({
        id: "southside-talk",
        title: "Southside Talk",
        location: "Telegraph Avenue",
        description: "A southside talk for Berkeley students.",
      }),
    ]);

    window.history.replaceState({}, "", "/?q=northside%20talks");

    render(<App />);

    expect(screen.getByText("Northside")).toBeInTheDocument();
    expect(screen.getByText("Northside Talk")).toBeInTheDocument();
    expect(screen.queryByText("Southside Talk")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /remove northside filter/i }),
    );

    await waitFor(() => {
      expect(screen.queryByText("Northside")).not.toBeInTheDocument();
      expect(screen.getByText("Southside Talk")).toBeInTheDocument();
    });
  });

  it("opens event details from the primary card action", async () => {
    const user = userEvent.setup();

    mockFeedState = makeFeedState([
      makeEvent({
        id: "detail-primary",
        title: "Primary Card Action",
        description: "An event opened from the main card button.",
      }),
    ]);

    render(<App />);

    await user.click(
      screen.getByRole("button", {
        name: /open details for primary card action/i,
      }),
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /close event details/i }),
    ).toBeInTheDocument();
  });

  it("opens event details and syncs the selected event into the URL", async () => {
    const user = userEvent.setup();

    mockFeedState = makeFeedState([
      makeEvent({
        id: "detail-1",
        title: "Design Review Night",
        description: "A design review event.",
      }),
    ]);

    render(<App />);

    await user.click(screen.getByRole("button", { name: /view details/i }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /close event details/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /view official page/i }),
    ).toHaveAttribute("href", "https://example.com/detail-1");

    await waitFor(() => {
      expect(window.location.search).toContain("event=detail-1");
    });
  });
});
