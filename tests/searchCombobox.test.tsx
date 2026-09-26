import React, { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { DesktopHero } from "../components/DesktopHero";
import { MobileHeader } from "../components/MobileHeader";
import { getRecentSearches } from "../utils/recentSearches";

const RECENT_SEARCHES_KEY = "cal-events:recent-v1";

function DesktopHarness() {
  const [query, setQuery] = useState("");
  return (
    <DesktopHero
      statusCopy=""
      summaryCopy=""
      searchQuery={query}
      onSearchChange={setQuery}
      onPresetSelect={() => {}}
      inputId="desktop-search"
    />
  );
}

function MobileHarness() {
  const [query, setQuery] = useState("");
  return <MobileHeader searchQuery={query} onSearchChange={setQuery} />;
}

function searchInput(): HTMLInputElement {
  return screen.getByRole("combobox", { name: /search campus events/i });
}

describe.each([
  ["desktop", DesktopHarness],
  ["mobile", MobileHarness],
])("%s search box", (_label, Harness) => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("submits the typed query on Enter", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(searchInput());
    await user.type(searchInput(), "robotics{Enter}");

    expect(searchInput()).toHaveValue("robotics");
    expect(getRecentSearches()).toEqual(["robotics"]);
  });

  it("submits the typed query on Enter when search history exists", async () => {
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(["film"]));
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(searchInput());
    await user.type(searchInput(), "robotics{Enter}");

    expect(searchInput()).toHaveValue("robotics");
  });

  it("hides recent and popular suggestions once the user types", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(searchInput());
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    await user.type(searchInput(), "r");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    await user.clear(searchInput());
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("selects a suggestion only after arrow-key navigation", async () => {
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(["film"]));
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(searchInput());
    expect(searchInput()).not.toHaveAttribute("aria-activedescendant");

    await user.keyboard("{ArrowDown}{Enter}");
    expect(searchInput()).toHaveValue("film");
  });

  it("wraps ArrowUp from no active option to the last suggestion", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(searchInput());
    await user.keyboard("{ArrowUp}{Enter}");

    expect(searchInput()).toHaveValue("Wellness");
  });
});
