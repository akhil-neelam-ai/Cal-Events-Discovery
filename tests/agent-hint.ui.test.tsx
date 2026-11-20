import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AGENT_PROMPT } from "../appConfig";
import {
  AGENT_PROMPT_DISMISSED_KEY,
  AgentPromptCard,
} from "../components/AgentPromptCard";
import { NoticeSheet } from "../components/NoticeSheet";
import { LoadingState } from "../types";
import { trackAgentPrompt } from "../utils/analytics";

vi.mock("../utils/analytics", () => ({ trackAgentPrompt: vi.fn() }));

const OLD_HINT_KEY = "cal-events:agent-hint-dismissed-v1";
const COPIED = "Copied. Paste it into your agent.";

function renderNotice(isMobile: boolean) {
  return render(
    <NoticeSheet
      isMobile={isMobile}
      todayKey="2026-04-22"
      weekEndKey="2026-04-28"
      loading={LoadingState.SUCCESS}
      allEventsCount={0}
      sourceCount={0}
      searchQuery=""
      activeDateRange="week"
      onSearchChange={() => {}}
      onPresetSelect={() => {}}
      onDateChange={() => {}}
      onSurprise={null}
    />,
  );
}

const copyButton = () =>
  screen.getByRole("button", { name: /^(Copy prompt|Copied\.)/ });
const promptBox = () =>
  screen.queryByRole("textbox", { name: "Prompt for your AI agent" });

// userEvent.setup() installs its own clipboard, so tests set theirs after.
function setClipboard(value: unknown) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    writable: true,
    value,
  });
}

describe("AgentPromptCard", () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(trackAgentPrompt).mockClear();
    writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows in the notice for every visitor, phone and desktop", () => {
    // No navigator.modelContext: the old tip hid here, the card does not.
    expect(navigator.modelContext).toBeUndefined();
    for (const isMobile of [false, true]) {
      const view = renderNotice(isMobile);
      expect(
        screen.getByText(
          "Have an AI agent? Copy a prompt and let it find events you'd like.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Copy prompt" }),
      ).toHaveTextContent(/^Copy prompt$/);
      expect(
        screen.getByRole("button", { name: "See the prompt" }),
      ).toHaveAttribute("aria-expanded", "false");
      view.unmount();
    }
  });

  it("copies the prompt and says so for a few seconds", async () => {
    vi.useFakeTimers();
    render(<AgentPromptCard />);

    await act(async () => {
      fireEvent.click(copyButton());
    });

    expect(writeText).toHaveBeenCalledExactlyOnceWith(AGENT_PROMPT);
    expect(copyButton()).toHaveTextContent(COPIED);
    expect(copyButton()).toHaveAccessibleName(COPIED);
    expect(screen.getByRole("status")).toHaveTextContent(COPIED);
    expect(trackAgentPrompt).toHaveBeenCalledExactlyOnceWith("copy");

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(copyButton()).toHaveTextContent(/^Copy prompt$/);
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("opens and selects the prompt when the clipboard refuses", async () => {
    const user = userEvent.setup();
    setClipboard({
      writeText: vi.fn().mockRejectedValue(new Error("denied")),
    });
    render(<AgentPromptCard />);
    expect(promptBox()).not.toBeInTheDocument();

    await user.click(copyButton());

    const box = promptBox() as HTMLTextAreaElement;
    expect(box).toBeInTheDocument();
    expect(box).toHaveFocus();
    expect(box.selectionStart).toBe(0);
    expect(box.selectionEnd).toBe(AGENT_PROMPT.length);
    expect(
      screen.getByRole("button", { name: "See the prompt" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(copyButton()).toHaveTextContent(/^Copy prompt$/);
    expect(trackAgentPrompt).toHaveBeenCalledExactlyOnceWith("copy_failed");
  });

  it("falls back the same way when there is no clipboard at all", async () => {
    const user = userEvent.setup();
    setClipboard(undefined);
    render(<AgentPromptCard />);

    await user.click(copyButton());
    expect(promptBox()).toHaveFocus();
  });

  it("shows the prompt and the agent page behind the disclosure", async () => {
    const user = userEvent.setup();
    render(<AgentPromptCard />);
    const disclosure = screen.getByRole("button", { name: "See the prompt" });

    await user.click(disclosure);
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    expect(promptBox()).toHaveValue(AGENT_PROMPT);
    expect(promptBox()).toHaveAttribute("readonly");
    expect(
      screen.getByRole("link", { name: "How agents use CalEvents" }),
    ).toHaveAttribute("href", "/for-agents.html");
    expect(trackAgentPrompt).toHaveBeenCalledExactlyOnceWith("show_prompt");

    await user.click(disclosure);
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(promptBox()).not.toBeInTheDocument();
  });

  it("stays hidden after a dismissal, and the old tip's key does not hide it", async () => {
    window.localStorage.setItem(OLD_HINT_KEY, "1");
    const user = userEvent.setup();
    const first = render(<AgentPromptCard />);

    await user.click(
      screen.getByRole("button", { name: "Hide the agent prompt" }),
    );
    expect(
      screen.queryByRole("button", { name: "Copy prompt" }),
    ).not.toBeInTheDocument();
    expect(window.localStorage.getItem(AGENT_PROMPT_DISMISSED_KEY)).toBe("1");

    first.unmount();
    render(<AgentPromptCard />);
    expect(
      screen.queryByRole("button", { name: "Copy prompt" }),
    ).not.toBeInTheDocument();
  });

  it("still hides when storage is blocked", async () => {
    const user = userEvent.setup();
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    try {
      render(<AgentPromptCard />);
      await user.click(
        screen.getByRole("button", { name: "Hide the agent prompt" }),
      );
      expect(
        screen.queryByRole("button", { name: "Copy prompt" }),
      ).not.toBeInTheDocument();
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });

  it("keeps the approved prompt text", () => {
    expect(AGENT_PROMPT.split("\n")).toEqual([
      "Help me keep up with UC Berkeley events I'd enjoy, using CalEvents (https://cal-events.com).",
      "",
      "1. Read https://cal-events.com/llms.txt first.",
      '2. Ask me two things in one message: "What kind of events would you like?" and "Do you want a daily digest, a weekly digest, or one a few times a week?"',
      "3. Read the day pages listed at https://cal-events.com/days/index.txt: today for a daily digest, the next three days for a few times a week, or the next seven days for a weekly one. Only suggest events you find there.",
      "4. Send me the events that fit best, and leave out weak matches. For each, give the title, day and time, place, one line on why it fits, and its link.",
      "5. If you can schedule tasks, repeat this at the pace I chose. If you can't, tell me, and I'll ask again when I want the next one.",
    ]);
  });
});
