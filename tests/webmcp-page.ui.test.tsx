import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "../App";
import { registerWebMcpTools } from "../agent/registerWebMcp";
import {
  getViewState,
  publishViewState,
  type UiViewState,
  VIEW_STATE_EVENT_ID_LIMIT,
} from "../agent/viewState";
import type { WebMcpTool } from "../agent/webmcpTools";
import type { CalEvent } from "../types";
import { LoadingState } from "../types";
import { TOPIC_VOCABULARY } from "../scripts/lib/topics";

// The agent -> page path end to end: a fake navigator.modelContext collects
// the registered tools, the agent calls them, and the rendered App answers.

const TODAY_KEY = "2026-04-22";
const TOMORROW_KEY = "2026-04-23";
const WEEK_END_KEY = "2026-04-28";

function makeEvent(id: string, title: string, date: string): CalEvent {
  return {
    id,
    title,
    organizer: "Berkeley Jazz Club",
    date,
    time: "7:00 PM",
    location: "Hertz Hall",
    description: `${title} for Berkeley students.`,
    tags: ["Arts & Culture"],
    topics: [],
    url: `https://example.com/${id}`,
    source: "livewhale",
  };
}

const EVENTS: CalEvent[] = [
  makeEvent("jazz-night", "Jazz Night", TOMORROW_KEY),
  makeEvent("jazz-brunch", "Jazz Brunch", "2026-04-25"),
];

let mockIndexSettled = true;

vi.mock("@vercel/analytics/react", () => ({ Analytics: () => null }));

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
  useEventFeed: () => ({
    allEvents: EVENTS,
    lastUpdated: Date.parse("2026-04-22T19:00:00Z"),
    loading: LoadingState.SUCCESS,
    searchIndex: null,
    searchIndexSettled: mockIndexSettled,
    topicVocabulary: TOPIC_VOCABULARY,
    sourceOptions: [
      { value: "All", label: "All", count: EVENTS.length },
      { value: "livewhale", label: "livewhale", count: EVENTS.length },
    ],
    sourceCount: 1,
    loadEvents: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("../hooks/useIsMobile", () => ({ useIsMobile: () => false }));
vi.mock("../hooks/useBackToTopVisibility", () => ({
  useBackToTopVisibility: () => false,
}));
vi.mock("../hooks/usePrefersReducedMotion", () => ({
  usePrefersReducedMotion: () => true,
}));
vi.mock("../hooks/usePacificDateKeys", () => ({
  usePacificDateKeys: () => ({
    todayKey: TODAY_KEY,
    tomorrowKey: TOMORROW_KEY,
    weekEndKey: WEEK_END_KEY,
    nowMinutes: 0,
  }),
}));

let tools: Map<string, WebMcpTool>;

async function callTool(name: string, input: Record<string, unknown> = {}) {
  const tool = tools.get(name);
  if (!tool) throw new Error(`tool ${name} was not registered`);
  let result: unknown;
  await act(async () => {
    result = await tool.execute(input);
  });
  return result as Record<string, unknown>;
}

async function readView(): Promise<UiViewState> {
  const state = await callTool("get_ui_state");
  const view = state.view as UiViewState | null;
  if (!view) throw new Error("get_ui_state returned no view");
  return view;
}

describe("WebMCP agent to page", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    window.sessionStorage.clear();
    mockIndexSettled = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) => {
        const body =
          path === "/events.json"
            ? { events: EVENTS, topic_vocabulary: TOPIC_VOCABULARY }
            : {};
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
    tools = new Map();
    Object.defineProperty(navigator, "modelContext", {
      configurable: true,
      value: {
        registerTool: (tool: WebMcpTool) => tools.set(tool.name, tool),
      },
    });
    registerWebMcpTools();
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, "modelContext");
    vi.unstubAllGlobals();
  });

  it("applies agent state to the page and reports the view back", async () => {
    render(<App />);

    const applied = await callTool("apply_ui_state", { q: "jazz tomorrow" });
    expect(applied.applied).toBe(true);

    await waitFor(() => {
      expect(screen.getByText("Jazz Night")).toBeInTheDocument();
      expect(screen.queryByText("Jazz Brunch")).not.toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: /remove tomorrow filter/i }),
    ).toBeInTheDocument();

    const view = await readView();
    expect(view).toMatchObject({
      todayKey: TODAY_KEY,
      loading: "success",
      pending: false,
      searchQuery: "jazz tomorrow",
      requestedDateRange: "tomorrow",
      effectiveDateRange: "tomorrow",
      dateRangeWidened: false,
      hasExplicitDateRange: false,
      dismissedChipKeys: [],
      resultCount: 1,
      visibleEventIds: ["jazz-night"],
      fallbackMessage: null,
    });
    expect(view.activeChips).toEqual([
      { key: "dateRange:tomorrow", label: "Tomorrow" },
    ]);
    expect(Object.isFrozen(view)).toBe(true);
  });

  it("drops a dismissed chip when the agent reapplies the same URL", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/?q=jazz%20tomorrow");
    render(<App />);

    await user.click(
      screen.getByRole("button", { name: /remove tomorrow filter/i }),
    );
    await waitFor(() => {
      expect(screen.getByText("Jazz Brunch")).toBeInTheDocument();
    });
    expect((await readView()).dismissedChipKeys).toEqual([
      "dateRange:tomorrow",
    ]);

    await callTool("apply_ui_state", { q: "jazz tomorrow" });

    await waitFor(() => {
      expect(screen.queryByText("Jazz Brunch")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Jazz Night")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /remove tomorrow filter/i }),
    ).toBeInTheDocument();
    const view = await readView();
    expect(view.dismissedChipKeys).toEqual([]);
    expect(view.effectiveDateRange).toBe("tomorrow");
  });

  it("keeps an explicit date=week over the query's own date", async () => {
    render(<App />);

    // apply_ui_state pushes the URL and fires popstate. This is that path.
    act(() => {
      window.history.pushState(null, "", "/?q=jazz+tomorrow&date=week");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    await waitFor(() => {
      expect(screen.getByText("Jazz Night")).toBeInTheDocument();
      expect(screen.getByText("Jazz Brunch")).toBeInTheDocument();
    });
    expect(new URLSearchParams(window.location.search).get("date")).toBe(
      "week",
    );

    const state = await callTool("get_ui_state");
    expect(state.hasExplicitDateRange).toBe(true);
    expect(state.view).toMatchObject({
      requestedDateRange: "week",
      effectiveDateRange: "week",
      hasExplicitDateRange: true,
      resultCount: 2,
    });
  });

  it("reports a today search that widened to the week", async () => {
    render(<App />);

    await callTool("apply_ui_state", { q: "jazz today" });

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /remove today filter/i }),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("Jazz Night")).toBeInTheDocument();
    expect(await readView()).toMatchObject({
      requestedDateRange: "today",
      effectiveDateRange: "week",
      dateRangeWidened: true,
    });
  });

  it("compares typing after an agent apply against the applied query", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/?q=brunch");
    render(<App />);

    await callTool("apply_ui_state", { q: "jazz tomorrow" });
    await user.click(
      await screen.findByRole("button", { name: /remove tomorrow filter/i }),
    );
    await waitFor(() => {
      expect(screen.getByText("Jazz Brunch")).toBeInTheDocument();
    });

    // Same first word as the applied query, so the dismissal stays. Compared
    // against the page's first query, "brunch", it would reset.
    await user.type(
      screen.getByRole("combobox", { name: /search campus events/i }),
      "!",
    );
    await waitFor(async () => {
      expect((await readView()).searchQuery).toBe("jazz tomorrow!");
    });
    expect(
      screen.queryByRole("button", { name: /remove tomorrow filter/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Jazz Brunch")).toBeInTheDocument();
    expect((await readView()).dismissedChipKeys).toEqual([
      "dateRange:tomorrow",
    ]);
  });
});

describe("view snapshot", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    mockIndexSettled = true;
  });

  afterEach(() => {
    publishViewState(null);
  });

  it("is pending while the search index has not settled for a query", () => {
    mockIndexSettled = false;
    window.history.replaceState({}, "", "/?q=jazz");
    const { unmount } = render(<App />);
    expect(getViewState()?.pending).toBe(true);
    unmount();

    // A query too short to search does not wait for the index.
    window.history.replaceState({}, "", "/?q=j");
    render(<App />);
    expect(getViewState()?.pending).toBe(false);
  });

  it("clears when the page unmounts", () => {
    const { unmount } = render(<App />);
    expect(getViewState()).not.toBeNull();
    unmount();
    expect(getViewState()).toBeNull();
  });

  it("keeps only the first visible event ids", () => {
    const ids = Array.from({ length: 25 }, (_, index) => `event-${index}`);
    publishViewState({
      todayKey: TODAY_KEY,
      loading: "success",
      pending: false,
      searchQuery: "",
      requestedDateRange: "week",
      effectiveDateRange: "week",
      dateRangeWidened: false,
      hasExplicitDateRange: false,
      category: "All",
      source: "All",
      topic: "",
      activeChips: [],
      dismissedChipKeys: [],
      resultCount: ids.length,
      visibleEventIds: ids,
      fallbackMessage: null,
      notice: null,
      selectedEventId: null,
    });
    const view = getViewState();
    expect(VIEW_STATE_EVENT_ID_LIMIT).toBe(20);
    expect(view?.visibleEventIds).toEqual(ids.slice(0, 20));
    expect(view?.resultCount).toBe(25);
    expect(Object.isFrozen(view?.visibleEventIds)).toBe(true);
  });
});
