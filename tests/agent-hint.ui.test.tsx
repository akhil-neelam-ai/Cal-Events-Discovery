import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AGENT_HINT_DISMISSED_KEY, AgentHint } from "../components/AgentHint";
import { DesktopHero } from "../components/DesktopHero";
import { MobileHeader } from "../components/MobileHeader";

function installModelContext() {
  Object.defineProperty(navigator, "modelContext", {
    configurable: true,
    value: { registerTool: vi.fn() },
  });
}

const hintLink = () =>
  screen.queryByRole("link", { name: /how agents use calevents/i });

describe("AgentHint", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, "modelContext");
  });

  it("renders nothing when the browser has no modelContext", () => {
    const { container } = render(<AgentHint variant="desktop" />);
    expect(container).toBeEmptyDOMElement();
    expect(hintLink()).not.toBeInTheDocument();
  });

  it("shows the line and link under both search boxes with modelContext", () => {
    installModelContext();
    render(
      <DesktopHero
        statusCopy="Updated daily"
        summaryCopy="Search events"
        searchQuery=""
        onSearchChange={() => {}}
        onPresetSelect={() => {}}
        inputId="desktop-search"
      />,
    );
    expect(screen.getByText(/using an ai agent\?/i)).toBeInTheDocument();
    expect(hintLink()).toHaveAttribute("href", "/for-agents.html");
    expect(
      screen.getByRole("button", { name: "Dismiss AI agent tip" }),
    ).toBeInTheDocument();

    render(<MobileHeader searchQuery="" onSearchChange={() => {}} />);
    expect(
      screen.getAllByRole("link", { name: /how agents use calevents/i }),
    ).toHaveLength(2);
  });

  it("stays dismissed after a remount", async () => {
    const user = userEvent.setup();
    installModelContext();
    const first = render(<AgentHint variant="mobile" />);

    await user.click(
      screen.getByRole("button", { name: "Dismiss AI agent tip" }),
    );
    expect(hintLink()).not.toBeInTheDocument();
    expect(window.localStorage.getItem(AGENT_HINT_DISMISSED_KEY)).toBe("1");

    first.unmount();
    render(<AgentHint variant="mobile" />);
    expect(hintLink()).not.toBeInTheDocument();
  });

  it("still dismisses when storage is blocked", async () => {
    const user = userEvent.setup();
    installModelContext();
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
      render(<AgentHint variant="desktop" />);
      await user.click(
        screen.getByRole("button", { name: "Dismiss AI agent tip" }),
      );
      expect(hintLink()).not.toBeInTheDocument();
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });
});
