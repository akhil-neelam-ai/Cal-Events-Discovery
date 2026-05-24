import { useEffect, useRef, useState } from "react";

import { CAL_PHRASES, DESKTOP_HERO_PRESETS } from "../appConfig";
import type { QuickFilterPreset } from "../appConfig";
import { useSearchCombobox } from "../hooks/useSearchCombobox";
import {
  addRecentSearch,
  clearRecentSearches,
  getRecentSearches,
} from "../utils/recentSearches";
import { SearchSuggestionsDropdown } from "./SearchSuggestionsDropdown";

export function DesktopHero({
  statusCopy,
  summaryCopy,
  searchQuery,
  onSearchChange,
  onPresetSelect,
  inputId,
}: {
  statusCopy: string;
  summaryCopy: string;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onPresetSelect: (preset: QuickFilterPreset) => void;
  inputId: string;
}) {
  const [phraseIdx] = useState(() =>
    Math.floor(Math.random() * CAL_PHRASES.length),
  );
  const phrase = CAL_PHRASES[phraseIdx];
  const [searchFocused, setSearchFocused] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listboxRef = useRef<HTMLDivElement | null>(null);
  const isSuggestionsOpen = searchFocused;

  const closeSuggestions = () => setSearchFocused(false);

  const handleSelectSuggestion = (query: string) => {
    onSearchChange(query);
    addRecentSearch(query);
    setRecents(getRecentSearches());
    closeSuggestions();
  };

  const {
    suggestions,
    activeIndex,
    activeDescendantId,
    handleInputKeyDown,
    getItemProps,
    suggestionCount,
  } = useSearchCombobox({
    isOpen: isSuggestionsOpen,
    recents,
    onSelect: handleSelectSuggestion,
    onClose: closeSuggestions,
  });

  useEffect(() => {
    return () => {
      if (blurTimerRef.current) {
        clearTimeout(blurTimerRef.current);
      }
    };
  }, []);

  const handleFocus = () => {
    if (blurTimerRef.current) {
      clearTimeout(blurTimerRef.current);
    }
    setRecents(getRecentSearches());
    setSearchFocused(true);
  };

  const handleBlur = () => {
    blurTimerRef.current = setTimeout(() => closeSuggestions(), 150);
  };

  return (
    <header
      className="relative hidden border-b-4 border-[#FDB515] text-white shadow-md md:block"
      style={{
        background: "linear-gradient(165deg, #003262 0%, #00233F 100%)",
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div
          className="absolute -right-16 -top-16 h-[440px] w-[440px] rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(253,181,21,0.38) 0%, transparent 60%)",
            mixBlendMode: "screen",
          }}
        />
        <div
          className="absolute -bottom-16 -left-16 h-[320px] w-[320px] rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(253,181,21,0.18) 0%, transparent 60%)",
            mixBlendMode: "screen",
          }}
        />
      </div>
      <div className="container relative z-10 mx-auto px-6 py-8 lg:py-9">
        <div className="mb-6 flex items-center justify-between gap-6">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-berkeley-gold">
              Cal
            </span>
            <span className="text-2xl font-light tracking-wide">Events</span>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-xs text-berkeley-gold/90">
            <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,0.18)]" />
            {statusCopy}
          </div>
        </div>

        <div className="mx-auto max-w-3xl text-center">
          <h1
            className="font-serif text-4xl font-semibold leading-tight lg:text-[3.35rem]"
            style={{ textWrap: "balance", letterSpacing: "-0.02em" }}
          >
            {phrase.plain}&nbsp;
            <span
              className="font-medium italic text-berkeley-gold"
              style={{ textShadow: "0 0 40px rgba(253,181,21,0.35)" }}
            >
              {phrase.gold}
            </span>
          </h1>
          <p className="mt-3 text-[15px] leading-7 text-white/72">
            {summaryCopy}
          </p>

          <div
            className="mt-6 rounded-[1.5rem] border border-white/10 bg-white p-4"
            style={{
              boxShadow:
                "0 2px 4px rgba(0,50,98,0.08), 0 12px 40px rgba(0,50,98,0.18), 0 0 0 1px rgba(253,181,21,0.12)",
            }}
          >
            <div className="relative">
              <label htmlFor={inputId} className="sr-only">
                Search campus events
              </label>
              <svg
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                id={inputId}
                type="text"
                name="event-search"
                role="combobox"
                aria-expanded={isSuggestionsOpen}
                aria-controls="search-suggestions"
                aria-autocomplete="list"
                aria-activedescendant={activeDescendantId}
                aria-label="Search campus events"
                autoComplete="off"
                placeholder="Search events, speakers, topics, or venues…"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-4 pl-12 pr-5 text-base text-slate-900 outline-none transition focus:border-berkeley-medblue focus:bg-white focus-visible:ring-2 focus-visible:ring-berkeley-gold focus-visible:ring-offset-2"
                value={searchQuery}
                onChange={(event) => onSearchChange(event.target.value)}
                onFocus={handleFocus}
                onBlur={handleBlur}
                onKeyDown={(event) => {
                  handleInputKeyDown(event);
                  if (event.defaultPrevented) {
                    return;
                  }
                  if (event.key === "Enter" && searchQuery.trim()) {
                    const trimmed = searchQuery.trim();
                    onSearchChange(trimmed);
                    addRecentSearch(trimmed);
                    closeSuggestions();
                  }
                }}
                aria-describedby={
                  isSuggestionsOpen && suggestionCount > 0
                    ? "search-suggestion-count-desktop"
                    : undefined
                }
              />
              {isSuggestionsOpen && suggestionCount > 0 && (
                <span id="search-suggestion-count-desktop" className="sr-only">
                  {suggestionCount} suggestions available. Use up and down
                  arrows to navigate.
                </span>
              )}
              {isSuggestionsOpen && (
                <SearchSuggestionsDropdown
                  recents={recents}
                  suggestions={suggestions}
                  activeIndex={activeIndex}
                  getItemProps={getItemProps}
                  listboxRef={listboxRef}
                  placement="inline"
                  onSelect={handleSelectSuggestion}
                  onClear={() => {
                    clearRecentSearches();
                    setRecents([]);
                  }}
                />
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-center gap-3 border-t border-slate-100 pt-3">
              <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                Quick Start
              </span>
              {DESKTOP_HERO_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => onPresetSelect(preset)}
                  className="rounded-full border border-[rgba(253,181,21,0.5)] bg-[rgba(253,181,21,0.08)] px-4 py-2 text-sm font-medium text-[#003262] transition hover:border-[#FDB515] hover:bg-[rgba(253,181,21,0.18)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-berkeley-gold focus-visible:ring-offset-2"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
