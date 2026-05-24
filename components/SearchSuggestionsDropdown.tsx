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

export function SearchSuggestionsDropdown({
  recents,
  suggestions,
  activeIndex,
  getItemProps,
  onSelect,
  onClear,
  placement = "overlay",
  listboxRef,
}: {
  recents: string[];
  suggestions: string[];
  activeIndex: number;
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
  placement?: "overlay" | "inline";
  listboxRef?: RefObject<HTMLDivElement | null>;
}) {
  const wrapperClassName =
    placement === "inline"
      ? "mt-2 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg animate-dropdown-in"
      : "absolute left-0 right-0 top-full z-[60] mt-1.5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl animate-dropdown-in";

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
      className={wrapperClassName}
      style={{
        transformOrigin: "top center",
        maxHeight:
          placement === "inline" ? "min(280px, 32vh)" : "min(320px, 40vh)",
      }}
    >
      <div className="h-full overflow-y-auto no-scrollbar">
        {recentSuggestions.length > 0 && (
          <div className="p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Recent
              </span>
              <button
                type="button"
                onPointerDown={(event) => {
                  event.preventDefault();
                  onClear();
                }}
                onClick={(event) => {
                  if (event.detail === 0) onClear();
                }}
                className="text-[11px] text-slate-400 tap-highlight hover:text-slate-600 active:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-berkeley-gold focus-visible:ring-offset-2"
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
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm tap-highlight hover:bg-slate-50 active:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-berkeley-gold focus-visible:ring-offset-2 ${
                    activeIndex === index
                      ? "bg-slate-100 text-berkeley-blue"
                      : "text-slate-700"
                  }`}
                >
                  <svg
                    aria-hidden="true"
                    className="h-3.5 w-3.5 flex-shrink-0 text-slate-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  {query}
                </button>
              );
            })}
          </div>
        )}
        {popularSuggestions.length > 0 && (
          <div
            className={`p-3 ${recentSuggestions.length > 0 ? "border-t border-slate-100" : ""}`}
          >
            <span className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Popular
            </span>
            <div className="flex flex-wrap gap-1.5">
              {popularSuggestions.map((query) => {
                const index = suggestions.indexOf(query);
                return (
                  <button
                    key={query}
                    type="button"
                    {...getItemProps(index)}
                    {...suggestionHandlers(query, onSelect)}
                    className={`select-none rounded-full border px-3 py-1 text-xs tap-highlight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-berkeley-gold focus-visible:ring-offset-2 ${
                      activeIndex === index
                        ? "border-berkeley-gold bg-berkeley-gold/25 text-berkeley-blue"
                        : "border-berkeley-gold/30 bg-berkeley-gold/10 text-berkeley-blue hover:bg-berkeley-gold/20 active:bg-berkeley-gold/30"
                    }`}
                  >
                    {query}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
