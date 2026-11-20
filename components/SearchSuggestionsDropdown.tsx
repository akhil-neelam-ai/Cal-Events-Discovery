import type { KeyboardEvent, MouseEvent, PointerEvent, RefObject } from "react";

import { POPULAR_SEARCHES } from "../appConfig";

function suggestionHandlers(query: string, onSelect: (query: string) => void) {
  return {
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      onSelect(query);
    },
    onClick: (event: MouseEvent<HTMLButtonElement>) => {
      if (event.detail === 0) onSelect(query);
    },
  };
}

/** A paper slip under the search blank with recent and popular searches. */
export function SearchSuggestionsDropdown({
  recents,
  suggestions,
  getItemProps,
  onSelect,
  onClear,
  listboxRef,
}: {
  recents: string[];
  suggestions: string[];
  getItemProps: (index: number) => {
    ref: (element: HTMLButtonElement | null) => void;
    id: string;
    role: "option";
    "aria-selected": boolean;
    onMouseEnter: () => void;
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  };
  onSelect: (query: string) => void;
  onClear: () => void;
  listboxRef?: RefObject<HTMLDivElement | null>;
}) {
  const recentSuggestions = suggestions.filter((item) =>
    recents.includes(item),
  );
  const popularSuggestions = POPULAR_SEARCHES.filter((item) =>
    suggestions.includes(item),
  );

  return (
    <div
      ref={listboxRef}
      id="search-suggestions"
      role="listbox"
      aria-label="Search suggestions"
      className="slip slip-search"
    >
      {recentSuggestions.length > 0 && (
        <div className="slip-section">
          <div className="slip-head">
            <span>Recent searches</span>
            <button
              type="button"
              onPointerDown={(event) => {
                event.preventDefault();
                onClear();
              }}
              onClick={(event) => {
                if (event.detail === 0) onClear();
              }}
            >
              Clear
            </button>
          </div>
          {recentSuggestions.map((query) => {
            const index = suggestions.indexOf(query);
            return (
              <button
                key={query}
                type="button"
                {...getItemProps(index)}
                {...suggestionHandlers(query, onSelect)}
                className="slip-row"
              >
                {query}
              </button>
            );
          })}
        </div>
      )}
      {popularSuggestions.length > 0 && (
        <div className="slip-section">
          <span className="slip-head">Popular</span>
          <div className="slip-chips">
            {popularSuggestions.map((query) => {
              const index = suggestions.indexOf(query);
              return (
                <button
                  key={query}
                  type="button"
                  {...getItemProps(index)}
                  {...suggestionHandlers(query, onSelect)}
                  className="slip-chip"
                >
                  {query}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
