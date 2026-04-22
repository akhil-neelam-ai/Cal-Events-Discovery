import { POPULAR_SEARCHES } from "../appConfig";

export function SearchSuggestionsDropdown({
  recents,
  onSelect,
  onClear,
}: {
  recents: string[];
  onSelect: (query: string) => void;
  onClear: () => void;
}) {
  return (
    <div
      className="absolute left-0 right-0 top-full z-[60] mt-1.5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl animate-dropdown-in"
      style={{ transformOrigin: "top center", maxHeight: "min(320px, 40vh)" }}
    >
      <div className="h-full overflow-y-auto no-scrollbar">
        {recents.length > 0 && (
          <div className="p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Recent
              </span>
              <button
                type="button"
                onClick={onClear}
                className="text-[11px] text-slate-400 tap-highlight hover:text-slate-600 active:text-slate-800"
              >
                Clear
              </button>
            </div>
            {recents.map((query) => (
              <button
                key={query}
                type="button"
                onClick={() => onSelect(query)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm text-slate-700 tap-highlight hover:bg-slate-50 active:bg-slate-100"
              >
                <svg
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
            ))}
          </div>
        )}
        <div
          className={`p-3 ${recents.length > 0 ? "border-t border-slate-100" : ""}`}
        >
          <span className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-slate-400">
            Popular
          </span>
          <div className="flex flex-wrap gap-1.5">
            {POPULAR_SEARCHES.map((query) => (
              <button
                key={query}
                type="button"
                onClick={() => onSelect(query)}
                className="select-none rounded-full border border-berkeley-gold/30 bg-berkeley-gold/10 px-3 py-1 text-xs text-berkeley-blue tap-highlight hover:bg-berkeley-gold/20 active:bg-berkeley-gold/30"
              >
                {query}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
