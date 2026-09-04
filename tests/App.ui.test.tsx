import React from "react";
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App from "../App";
import { DEFAULT_FILTERS } from "../appConfig";
import { useEventBrowserActions } from "../hooks/useEventBrowserActions";
import { useUrlStateSync } from "../hooks/useUrlStateSync";
import type { CalEvent } from "../types";
import { LoadingState } from "../types";
import { TOPIC_VOCABULARY } from "../scripts/lib/topics";

const TODAY_KEY = "2026-04-22";
const TOMORROW_KEY = "2026-04-23";
const NEXT_WEEK_KEY = "2026-04-29";

type MockFeedState = {
  allEvents: CalEvent[];
  lastUpdated: number | null;
  dataAgeHours: number;
  degradedSources: string[];
  loading: LoadingState;
  statusReport: null;
  searchIndex: null;
  topicVocabulary: typeof TOPIC_VOCABULARY;
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
    topics: overrides.topics ?? ["ai-machine-learning"],
    url: overrides.url ?? `https://example.com/${id}`,
    source: overrides.source ?? "livewhale",
  };
}

function makeFeedState(events: CalEvent[]): MockFeedState {
  return {
    allEvents: events,
    lastUpdated: Date.parse("2026-04-22T19:00:00Z"),
    dataAgeHours: 0,
    degradedSources: [],
    loading: LoadingState.SUCCESS,
    statusReport: null,
    searchIndex: null,
    topicVocabulary: TOPIC_VOCABULARY,
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

  it("replaces one selected topic and toggles the active topic off", () => {
    const onHistoryIntent = vi.fn();
    const { result } = renderHook(() => {
      const [filters, setFilters] = React.useState(DEFAULT_FILTERS);
      const [, setSelectedEventId] = React.useState<string | null>(null);
      const [, setUserSetDateRange] = React.useState(false);
      const [, setDismissedInterpretationKeys] = React.useState<Set<string>>(
        new Set(),
      );
      const searchTimeoutRef = React.useRef<ReturnType<
        typeof setTimeout
      > | null>(null);
      const actions = useEventBrowserActions({
        filteredEventsCount: 0,
        initialSearchQuery: "",
        setFilters,
        setSelectedEventId,
        setUserSetDateRange,
        setDismissedInterpretationKeys,
        onHistoryIntent,
        searchTimeoutRef,
      });
      return { filters, ...actions };
    });

    act(() => result.current.handleTopicChange("ai-machine-learning"));
    expect(result.current.filters.topic).toBe("ai-machine-learning");

    act(() => result.current.handleTopicChange("law"));
    expect(result.current.filters.topic).toBe("law");

    act(() => result.current.handleTopicChange("law"));
    expect(result.current.filters.topic).toBe("");
    expect(onHistoryIntent).toHaveBeenNthCalledWith(1, "push");
    expect(onHistoryIntent).toHaveBeenNthCalledWith(2, "push");
    expect(onHistoryIntent).toHaveBeenNthCalledWith(3, "push");
  });

  it("keeps a popstate topic provisional while the vocabulary is loading", () => {
    const { result } = renderHook(() => {
      const [filters, setFilters] = React.useState(DEFAULT_FILTERS);
      const [selectedEventId, setSelectedEventId] = React.useState<
        string | null
      >(null);
      const [, setUserSetDateRange] = React.useState(false);

      useUrlStateSync({
        filters,
        allowedTopicSlugs: null,
        selectedEventId,
        setFilters,
        setSelectedEventId,
        setUserSetDateRange,
      });

      return filters;
    });

    act(() => {
      window.history.pushState({}, "", "/?topic=provisional-topic");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(result.current.topic).toBe("provisional-topic");
    expect(window.location.search).toBe("?topic=provisional-topic");
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
      screen.getByRole("combobox", { name: /search campus events/i }),
    ).toHaveValue("ai");
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: /science & tech · this week/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("AI Research Forum")).toBeInTheDocument();
  });

  it("restores query, date, category, source, topic, and event together", async () => {
    mockFeedState = makeFeedState([
      makeEvent({
        id: "target-event",
        title: "AI Policy Forum",
        tags: ["Academic"],
        topics: ["ai-machine-learning"],
        source: "livewhale",
      }),
      makeEvent({
        id: "wrong-topic",
        title: "Law Policy Forum",
        tags: ["Academic"],
        topics: ["law"],
        source: "livewhale",
      }),
      makeEvent({
        id: "wrong-category",
        title: "AI Film Forum",
        tags: ["Arts"],
        topics: ["ai-machine-learning"],
        source: "livewhale",
      }),
      makeEvent({
        id: "wrong-source",
        title: "AI Student Forum",
        tags: ["Academic"],
        topics: ["ai-machine-learning"],
        source: "callink",
      }),
    ]);

    window.history.replaceState(
      {},
      "",
      "/?q=forum&date=week&category=Academic&topic=ai-machine-learning&source=livewhale&event=target-event",
    );

    render(<App />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getAllByText("AI Policy Forum")).toHaveLength(2);
    expect(screen.queryByText("Law Policy Forum")).not.toBeInTheDocument();
    expect(screen.queryByText("AI Film Forum")).not.toBeInTheDocument();
    expect(screen.queryByText("AI Student Forum")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(window.location.search).toContain("topic=ai-machine-learning");
      expect(window.location.search).toContain("event=target-event");
    });
  });

  it("rejects a URL topic outside the published vocabulary", async () => {
    mockFeedState = makeFeedState([
      makeEvent({ id: "ai", topics: ["ai-machine-learning"] }),
      makeEvent({ id: "law", title: "Law Talk", topics: ["law"] }),
    ]);
    window.history.replaceState({}, "", "/?topic=made-up");

    render(<App />);

    expect(screen.getByText("AI Seminar")).toBeInTheDocument();
    expect(screen.getByText("Law Talk")).toBeInTheDocument();
    await waitFor(() => {
      expect(window.location.search).not.toContain("topic=");
    });
  });

  it("intersects category and topic filters", () => {
    mockFeedState = makeFeedState([
      makeEvent({
        id: "academic-ai",
        title: "Academic AI Talk",
        tags: ["Academic"],
        topics: ["ai-machine-learning"],
      }),
      makeEvent({
        id: "arts-ai",
        title: "Arts AI Talk",
        tags: ["Arts"],
        topics: ["ai-machine-learning"],
      }),
      makeEvent({
        id: "academic-law",
        title: "Academic Law Talk",
        tags: ["Academic"],
        topics: ["law"],
      }),
    ]);
    window.history.replaceState(
      {},
      "",
      "/?category=Academic&topic=ai-machine-learning",
    );

    render(<App />);

    expect(screen.getByText("Academic AI Talk")).toBeInTheDocument();
    expect(screen.queryByText("Arts AI Talk")).not.toBeInTheDocument();
    expect(screen.queryByText("Academic Law Talk")).not.toBeInTheDocument();
  });

  it("clears an active topic when another filter makes it unavailable", async () => {
    const user = userEvent.setup();
    mockFeedState = makeFeedState([
      makeEvent({
        id: "academic-ai",
        title: "Academic AI Talk",
        tags: ["Academic"],
        topics: ["ai-machine-learning"],
      }),
      makeEvent({
        id: "sports-law",
        title: "Sports Law Talk",
        tags: ["Sports"],
        topics: ["law"],
      }),
    ]);
    window.history.replaceState({}, "", "/?topic=ai-machine-learning");

    render(<App />);
    expect(screen.getByText("Academic AI Talk")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sports" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Topic cleared because no events match it with the other filters.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByText("Sports Law Talk")).toBeInTheDocument();
      expect(window.location.search).toContain("category=Sports");
      expect(window.location.search).not.toContain("topic=");
    });
  });

  it("keeps event details open when another filter auto-clears the topic", async () => {
    const user = userEvent.setup();
    mockFeedState = makeFeedState([
      makeEvent({
        id: "academic-ai-detail",
        title: "Academic AI Detail",
        tags: ["Academic"],
        topics: ["ai-machine-learning"],
      }),
      makeEvent({
        id: "sports-law-detail",
        title: "Sports Law Detail",
        tags: ["Sports"],
        topics: ["law"],
      }),
    ]);
    window.history.replaceState({}, "", "/?topic=ai-machine-learning");

    render(<App />);
    await user.click(
      screen.getByRole("button", { name: /academic ai detail/i }),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sports" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Topic cleared because no events match it with the other filters.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: "Academic AI Detail" }),
      ).toBeInTheDocument();
      expect(window.location.search).toContain("event=academic-ai-detail");
      expect(window.location.search).not.toContain("topic=");
    });
  });

  it("treats a topic as unavailable when the selected source has no matches", async () => {
    mockFeedState = makeFeedState([
      makeEvent({
        id: "livewhale-ai",
        title: "LiveWhale AI Talk",
        topics: ["ai-machine-learning"],
        source: "livewhale",
      }),
      makeEvent({
        id: "callink-law",
        title: "CalLink Law Talk",
        topics: ["law"],
        source: "callink",
      }),
    ]);
    window.history.replaceState(
      {},
      "",
      "/?source=callink&topic=ai-machine-learning",
    );

    render(<App />);

    await waitFor(() => {
      expect(
        screen.getByText(
          "Topic cleared because no events match it with the other filters.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByText("CalLink Law Talk")).toBeInTheDocument();
      expect(screen.queryByText("LiveWhale AI Talk")).not.toBeInTheDocument();
      expect(window.location.search).toContain("source=callink");
      expect(window.location.search).not.toContain("topic=");
    });
  });

  it("clears an active topic when a date-range change empties it", async () => {
    const user = userEvent.setup();
    mockFeedState = makeFeedState([
      makeEvent({
        id: "today-law",
        title: "Today Law Talk",
        date: TODAY_KEY,
        topics: ["law"],
      }),
      makeEvent({
        id: "tomorrow-ai",
        title: "Tomorrow AI Talk",
        date: TOMORROW_KEY,
        topics: ["ai-machine-learning"],
      }),
    ]);
    window.history.replaceState(
      {},
      "",
      "/?date=week&topic=ai-machine-learning",
    );

    render(<App />);
    expect(screen.getByText("Tomorrow AI Talk")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Today" }));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Topic cleared because no events match it with the other filters.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByText("Today Law Talk")).toBeInTheDocument();
      expect(window.location.search).toContain("date=today");
      expect(window.location.search).not.toContain("topic=");
    });
  });

  it("treats explicit URL date filters as user-selected", () => {
    mockFeedState = makeFeedState([
      makeEvent({
        id: "tomorrow-planning",
        title: "Tomorrow Planning Session",
        date: TOMORROW_KEY,
        description: "A session whose query implies tomorrow.",
      }),
    ]);

    window.history.replaceState({}, "", "/?q=tomorrow&date=upcoming");

    render(<App />);

    expect(
      screen.getByRole("heading", { level: 2, name: /upcoming/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Tomorrow Planning Session")).toBeInTheDocument();
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

    window.history.replaceState({}, "", "/?date=today");

    render(<App />);

    expect(
      screen.getByText("Nothing today — showing this week instead."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: /this week/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Tomorrow Founder Talk")).toBeInTheDocument();
  });

  it("defaults to this week on first visit", () => {
    mockFeedState = makeFeedState([
      makeEvent({
        id: "tomorrow-event",
        title: "Tomorrow Founder Talk",
        date: TOMORROW_KEY,
        description: "A founder talk happening tomorrow.",
      }),
    ]);

    render(<App />);

    expect(
      screen.queryByText("Nothing today — showing this week instead."),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: /this week/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Tomorrow Founder Talk")).toBeInTheDocument();
    expect(screen.getAllByText("Updates everyday").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Updated \d+h ago/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Synced \d+h ago/)).not.toBeInTheDocument();
  });

  it("keeps category filtering aligned with the primary event tag", async () => {
    const user = userEvent.setup();

    mockFeedState = makeFeedState([
      makeEvent({
        id: "arts-primary",
        title: "BAMPFA Screening",
        organizer: "BAMPFA",
        tags: ["Arts"],
        description: "A primary Arts event.",
      }),
      makeEvent({
        id: "academic-primary",
        title: "Cricket Archive Lecture",
        organizer: "Center for South Asia Studies",
        tags: ["Academic", "Arts", "Sports"],
        description: "An academic lecture with Arts as a secondary tag.",
      }),
    ]);

    render(<App />);

    expect(screen.getByText("BAMPFA Screening")).toBeInTheDocument();
    expect(screen.getByText("Cricket Archive Lecture")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Arts" }));

    expect(
      screen.getByRole("heading", { level: 2, name: /arts · this week/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("BAMPFA Screening")).toBeInTheDocument();
    expect(
      screen.queryByText("Cricket Archive Lecture"),
    ).not.toBeInTheDocument();
  });

  it("ranks artificial intelligence searches across categories", () => {
    mockFeedState = makeFeedState([
      makeEvent({
        id: "ai-science",
        title: "Responsible AI Seminar",
        tags: ["Science & Tech"],
        date: TOMORROW_KEY,
        description:
          "A technical seminar about artificial intelligence and machine learning systems.",
      }),
      makeEvent({
        id: "ai-arts",
        title: "A.I. Artificial Intelligence Film Screening",
        organizer: "BAMPFA",
        tags: ["Arts"],
        date: TOMORROW_KEY,
        description: "A film screening about artificial intelligence.",
      }),
    ]);

    window.history.replaceState(
      {},
      "",
      "/?q=Artificial%20Intelligence&date=upcoming",
    );

    render(<App />);

    expect(
      screen.queryByRole("button", { name: /remove science & tech filter/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Responsible AI Seminar")).toBeInTheDocument();
    expect(
      screen.getByText("A.I. Artificial Intelligence Film Screening"),
    ).toBeInTheDocument();
  });

  it("shows searched upcoming results in chronological order", () => {
    mockFeedState = makeFeedState([
      makeEvent({
        id: "june-ai",
        title: "Multi-Program AI Reunion Workshop",
        date: "2026-06-01",
        description: "AI AI AI workshop.",
      }),
      makeEvent({
        id: "may-ai",
        title: "Infrastructure for Science Agents",
        date: "2026-05-14",
        description: "AI agents talk.",
      }),
      makeEvent({
        id: "october-ai",
        title: "Trustworthy AI: Reliable Autonomy",
        date: "2026-10-05",
        description: "AI reliability talk.",
      }),
      makeEvent({
        id: "later-june-ai",
        title: "World Models and Social Reasoning",
        date: "2026-06-08",
        description: "AI reasoning lecture.",
      }),
    ]);

    window.history.replaceState({}, "", "/?q=AI&date=upcoming");

    render(<App />);

    const pageText = document.body.textContent ?? "";
    expect(pageText.indexOf("Infrastructure for Science Agents")).toBeLessThan(
      pageText.indexOf("Multi-Program AI Reunion Workshop"),
    );
    expect(pageText.indexOf("Multi-Program AI Reunion Workshop")).toBeLessThan(
      pageText.indexOf("World Models and Social Reasoning"),
    );
    expect(pageText.indexOf("World Models and Social Reasoning")).toBeLessThan(
      pageText.indexOf("Trustworthy AI: Reliable Autonomy"),
    );
  });

  it("applies tonight as an evening search and keeps all-day events visible", () => {
    mockFeedState = makeFeedState([
      makeEvent({
        id: "morning",
        title: "Morning Seminar",
        time: "9:00 AM",
        description: "A morning event.",
      }),
      makeEvent({
        id: "all-day",
        title: "All Day Exhibit",
        time: "All day",
        tags: ["Arts"],
        description: "An all-day exhibit.",
      }),
      makeEvent({
        id: "evening",
        title: "Evening Concert",
        time: "7:00 PM",
        tags: ["Arts"],
        description: "An evening concert.",
      }),
    ]);

    window.history.replaceState({}, "", "/?q=tonight");

    render(<App />);

    expect(screen.getByText("Evening Concert")).toBeInTheDocument();
    expect(screen.getByText("All Day Exhibit")).toBeInTheDocument();
    expect(screen.queryByText("Morning Seminar")).not.toBeInTheDocument();
  });

  it("uses the Tonight quick-start preset as an evening search", async () => {
    const user = userEvent.setup();

    mockFeedState = makeFeedState([
      makeEvent({
        id: "morning",
        title: "Morning Seminar",
        time: "9:00 AM",
        description: "A morning event.",
      }),
      makeEvent({
        id: "all-day",
        title: "All Day Exhibit",
        time: "All day",
        tags: ["Arts"],
        description: "An all-day exhibit.",
      }),
      makeEvent({
        id: "evening",
        title: "Evening Concert",
        time: "7:00 PM",
        tags: ["Arts"],
        description: "An evening concert.",
      }),
    ]);

    render(<App />);

    // The quick-start preset's accessible name now includes its hint ("After 5pm").
    await user.click(screen.getByRole("button", { name: /tonight/i }));

    expect(
      screen.getByRole("combobox", { name: /search campus events/i }),
    ).toHaveValue("tonight");
    await waitFor(() => {
      expect(screen.getByText("Evening Concert")).toBeInTheDocument();
      expect(screen.getByText("All Day Exhibit")).toBeInTheDocument();
      expect(screen.queryByText("Morning Seminar")).not.toBeInTheDocument();
    });
  });

  it("shows a clear-category empty state when search intent conflicts with the UI category", () => {
    mockFeedState = makeFeedState([
      makeEvent({
        id: "arts",
        title: "Arts Reception",
        tags: ["Arts"],
        description: "An arts event.",
      }),
      makeEvent({
        id: "baseball",
        title: "California Baseball vs Stanford",
        tags: ["Sports"],
        description: "A sports event.",
      }),
    ]);

    window.history.replaceState(
      {},
      "",
      "/?q=basketball&category=Arts&date=upcoming",
    );

    render(<App />);

    expect(screen.getByText("No “basketball” in Arts.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Clear “Arts”" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("California Baseball vs Stanford"),
    ).not.toBeInTheDocument();
  });

  it("interprets source names as source filters", () => {
    mockFeedState = makeFeedState([
      makeEvent({
        id: "law-source",
        title: "Law Certificate Ceremony",
        source: "berkeley_law",
        tags: ["Academic"],
        description: "A Berkeley Law ceremony.",
      }),
      makeEvent({
        id: "law-generic",
        title: "Berkeley Law and Finance Talk",
        source: "livewhale",
        tags: ["Academic"],
        description: "A generic campus event mentioning Berkeley Law.",
      }),
    ]);

    window.history.replaceState({}, "", "/?q=berkeley%20law&date=upcoming");

    render(<App />);

    expect(
      screen.getByRole("button", { name: /remove berkeley law filter/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Law Certificate Ceremony")).toBeInTheDocument();
    expect(
      screen.queryByText("Berkeley Law and Finance Talk"),
    ).not.toBeInTheDocument();
  });

  it("does not return the full selected source when source intent conflicts with the UI source", () => {
    mockFeedState = makeFeedState([
      makeEvent({
        id: "law-source",
        title: "Law Certificate Ceremony",
        source: "berkeley_law",
        tags: ["Academic"],
        description: "A Berkeley Law ceremony.",
      }),
      makeEvent({
        id: "law-livewhale",
        title: "Berkeley Law and Finance Talk",
        source: "livewhale",
        tags: ["Academic"],
        description: "A generic campus event mentioning Berkeley Law.",
      }),
      makeEvent({
        id: "unrelated-livewhale",
        title: "Campus Exhibit",
        source: "livewhale",
        tags: ["Arts"],
        description: "An unrelated campus event.",
      }),
    ]);

    window.history.replaceState(
      {},
      "",
      "/?q=berkeley%20law&source=livewhale&date=upcoming",
    );

    render(<App />);

    expect(
      screen.queryByRole("button", { name: /remove berkeley law filter/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Berkeley Law and Finance Talk"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Campus Exhibit")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Law Certificate Ceremony"),
    ).not.toBeInTheDocument();
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

    // The whole card is a single button labeled by the event title.
    await user.click(
      screen.getByRole("button", {
        name: /primary card action/i,
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

    await user.click(
      screen.getByRole("button", { name: /design review night/i }),
    );

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

  it("keeps event details open when filters exclude the selected event", async () => {
    const user = userEvent.setup();

    mockFeedState = makeFeedState([
      makeEvent({
        id: "detail-arts",
        title: "Gallery Detail Event",
        tags: ["Arts"],
        description: "An arts event that can be filtered out.",
      }),
      makeEvent({
        id: "sports-event",
        title: "California Baseball vs Stanford",
        tags: ["Sports"],
        description: "A sports event.",
      }),
    ]);

    render(<App />);

    await user.click(
      screen.getByRole("button", {
        name: /gallery detail event/i,
      }),
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sports" }));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: "Gallery Detail Event" }),
      ).toBeInTheDocument();
    });
  });
});
