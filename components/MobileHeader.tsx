import { useEffect, useId, useRef, useState } from "react";

import { useLiveTimestamp } from "../hooks/useLiveTimestamp";
import { useSearchCombobox } from "../hooks/useSearchCombobox";
import {
  addRecentSearch,
  clearRecentSearches,
  getRecentSearches,
} from "../utils/recentSearches";
import { SearchSuggestionsDropdown } from "./SearchSuggestionsDropdown";

export function MobileHeader({
  lastUpdated,
  searchQuery,
  onSearchChange,
}: {
  lastUpdated: number | null;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}) {
  const inputId = useId();
  const listboxRef = useRef<HTMLDivElement | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);
  const blurRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveUpdatedCopy = useLiveTimestamp(lastUpdated);
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
      if (blurRef.current) {
        clearTimeout(blurRef.current);
      }
    };
  }, []);

  return (
    <header
      className="bg-berkeley-blue text-white"
      style={{ boxShadow: "0 4px 24px rgba(0,50,98,0.18)" }}
    >
      <div className="container mx-auto flex flex-col gap-3 px-4 pb-3 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold tracking-tight text-berkeley-gold">
              Cal
            </span>
            <span className="text-2xl font-light tracking-wide">Events</span>
          </div>
          {liveUpdatedCopy && (
            <span className="flex items-center gap-1.5 text-[10px] text-berkeley-gold/70">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              Updated {liveUpdatedCopy}
            </span>
          )}
        </div>

        <div
          className="relative"
          style={{
            transition: "transform 200ms cubic-bezier(0.32, 0.72, 0, 1)",
            transform: searchFocused ? "scale(1.012)" : "scale(1)",
          }}
        >
          <label htmlFor={inputId} className="sr-only">
            Search campus events
          </label>
          <svg
            aria-hidden="true"
            xmlns="http://www.w3.org/2000/svg"
            className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2"
            style={{
              color: searchFocused ? "#FDB515" : "#94a3b8",
              transition: "color 200ms ease",
            }}
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
            name="event-search-mobile"
            role="combobox"
            aria-expanded={isSuggestionsOpen}
            aria-controls="search-suggestions"
            aria-autocomplete="list"
            aria-activedescendant={activeDescendantId}
            aria-label="Search campus events"
            autoComplete="off"
            placeholder="Search events, speakers, topics, or venues…"
            className="w-full rounded-2xl bg-white py-3 pl-11 pr-11 text-base text-slate-900 outline-hidden focus-visible:ring-2 focus-visible:ring-berkeley-gold focus-visible:ring-offset-2"
            style={{
              border: searchFocused
                ? "2px solid #FDB515"
                : "2px solid rgba(255,255,255,0.12)",
              boxShadow: searchFocused
                ? "0 0 0 4px rgba(253,181,21,0.18)"
                : "none",
              transition: "border-color 200ms ease, box-shadow 200ms ease",
            }}
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            onFocus={() => {
              if (blurRef.current) clearTimeout(blurRef.current);
              setRecents(getRecentSearches());
              setSearchFocused(true);
            }}
            onBlur={() => {
              blurRef.current = setTimeout(() => setSearchFocused(false), 150);
            }}
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
                ? "search-suggestion-count"
                : undefined
            }
          />
          {isSuggestionsOpen && suggestionCount > 0 && (
            <span id="search-suggestion-count" className="sr-only">
              {suggestionCount} suggestions available. Use up and down arrows to
              navigate.
            </span>
          )}
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 tap-highlight active:bg-slate-100 active:text-slate-700 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-berkeley-gold focus-visible:ring-offset-2"
            >
              <svg
                aria-hidden="true"
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
          {isSuggestionsOpen && (
            <SearchSuggestionsDropdown
              recents={recents}
              suggestions={suggestions}
              activeIndex={activeIndex}
              getItemProps={getItemProps}
              listboxRef={listboxRef}
              onSelect={handleSelectSuggestion}
              onClear={() => {
                clearRecentSearches();
                setRecents([]);
              }}
            />
          )}
        </div>
      </div>
    </header>
  );
}
