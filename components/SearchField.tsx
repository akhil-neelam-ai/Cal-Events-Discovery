import { useEffect, useId, useRef, useState } from "react";

import { useSearchCombobox } from "../hooks/useSearchCombobox";
import {
  addRecentSearch,
  clearRecentSearches,
  getRecentSearches,
} from "../utils/recentSearches";
import { SearchSuggestionsDropdown } from "./SearchSuggestionsDropdown";

const COUNT_HINT_ID = "search-suggestion-count";

/**
 * The form blank on the notice: a search combobox whose list offers recent
 * and popular searches before the user types.
 */
export function SearchField({
  searchQuery,
  onSearchChange,
}: {
  searchQuery: string;
  onSearchChange: (query: string) => void;
}) {
  const inputId = useId();
  const listboxRef = useRef<HTMLDivElement | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Recent and popular searches are not filtered by the query, so they only
  // help before the user starts typing.
  const isSuggestionsOpen = searchFocused && !searchQuery.trim();

  const closeSuggestions = () => setSearchFocused(false);

  const handleSelectSuggestion = (query: string) => {
    onSearchChange(query);
    addRecentSearch(query);
    setRecents(getRecentSearches());
    closeSuggestions();
  };

  const {
    suggestions,
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

  return (
    <div className="find" role="search">
      <label htmlFor={inputId}>Looking for</label>
      <div className="find-row">
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
          placeholder="a speaker, a topic, a place"
          className={searchQuery ? "has-clear" : undefined}
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          onFocus={() => {
            if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
            setRecents(getRecentSearches());
            setSearchFocused(true);
          }}
          onBlur={() => {
            blurTimerRef.current = setTimeout(closeSuggestions, 150);
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
            isSuggestionsOpen && suggestionCount > 0 ? COUNT_HINT_ID : undefined
          }
        />
        {isSuggestionsOpen && suggestionCount > 0 && (
          <span id={COUNT_HINT_ID} className="sr-only">
            {suggestionCount} suggestions available. Use up and down arrows to
            navigate.
          </span>
        )}
        {searchQuery && (
          <button
            type="button"
            className="find-clear"
            onClick={() => onSearchChange("")}
            aria-label="Clear search"
          >
            Clear
          </button>
        )}
        {isSuggestionsOpen && (
          <SearchSuggestionsDropdown
            recents={recents}
            suggestions={suggestions}
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
  );
}
