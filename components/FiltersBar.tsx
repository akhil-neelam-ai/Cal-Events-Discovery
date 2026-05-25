import { useState } from "react";

import { Categories, DateRanges } from "../appConfig";
import type { SourceOption } from "../appConfig";
import { SearchFilters } from "../types";
import { SourceDropdown } from "./SourceDropdown";

export function DesktopFiltersBar({
  filters,
  activeDateRange,
  sourceOptions,
  onDateChange,
  onCategoryChange,
  onSourceChange,
}: {
  filters: SearchFilters;
  activeDateRange: SearchFilters["dateRange"];
  sourceOptions: SourceOption[];
  onDateChange: (next: SearchFilters["dateRange"]) => void;
  onCategoryChange: (next: string) => void;
  onSourceChange: (next: string) => void;
}) {
  return (
    <div
      className="bg-white/90 backdrop-blur-md"
      style={{ boxShadow: "0 1px 0 rgba(253,181,21,0.22)" }}
    >
      <div className="container mx-auto flex items-center gap-3 overflow-x-auto whitespace-nowrap px-4 py-3 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-300">
        <div className="flex shrink-0 items-center gap-1 rounded-full bg-slate-100 p-1 shadow-inner">
          {DateRanges.map((range) => {
            const active = activeDateRange === range.value;
            return (
              <button
                key={range.value}
                type="button"
                onClick={() =>
                  onDateChange(range.value as SearchFilters["dateRange"])
                }
                className={`px-4 py-2 text-sm font-semibold transition ${
                  active
                    ? "rounded-none border-b-2 border-[#FDB515] bg-transparent text-berkeley-blue"
                    : "rounded-full text-slate-600 hover:bg-white hover:text-berkeley-blue"
                }`}
              >
                {range.label}
              </button>
            );
          })}
        </div>

        <div className="hidden h-6 w-px shrink-0 bg-slate-200 lg:block" />

        <div className="flex shrink-0 items-center gap-2">
          {Categories.map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => onCategoryChange(category)}
              className={`rounded-full border px-3 py-1.5 text-sm transition ${
                filters.category === category
                  ? "border-berkeley-blue bg-berkeley-blue text-white shadow-xs"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              {category}
            </button>
          ))}
        </div>

        <div className="hidden h-6 w-px shrink-0 bg-slate-200 lg:block" />

        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            Source
          </span>
          <SourceDropdown
            value={filters.source}
            options={sourceOptions}
            onChange={onSourceChange}
            tone="light"
          />
        </div>
      </div>
    </div>
  );
}

export function MobileFiltersBar({
  filters,
  activeDateRange,
  sourceOptions,
  onDateChange,
  onCategoryChange,
  onSourceChange,
}: {
  filters: SearchFilters;
  activeDateRange: SearchFilters["dateRange"];
  sourceOptions: SourceOption[];
  onDateChange: (next: SearchFilters["dateRange"]) => void;
  onCategoryChange: (next: string) => void;
  onSourceChange: (next: string) => void;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const activeFilterCount =
    Number(filters.category !== "All") + Number(filters.source !== "All");
  const selectedSource =
    sourceOptions.find((option) => option.value === filters.source)?.label ||
    "All sources";

  const handleDateSelect = (next: SearchFilters["dateRange"]) => {
    setAdvancedOpen(false);
    onDateChange(next);
  };

  return (
    <div className="border-b border-slate-200/80 bg-white/95 shadow-xs backdrop-blur-md">
      <div className="container mx-auto flex items-center gap-2 overflow-x-auto whitespace-nowrap px-4 py-2.5 no-scrollbar">
        {DateRanges.map((range) => {
          const active = activeDateRange === range.value;
          return (
            <button
              key={range.value}
              type="button"
              onClick={() =>
                handleDateSelect(range.value as SearchFilters["dateRange"])
              }
              className={`select-none rounded-full px-4 py-2 text-sm font-semibold tap-highlight ${
                active
                  ? "bg-berkeley-blue text-white shadow-[0_2px_10px_rgba(0,50,98,0.25)]"
                  : "bg-slate-100 text-slate-600 active:bg-slate-200"
              }`}
            >
              {range.label}
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setAdvancedOpen((open) => !open)}
          className={`ml-auto inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold tap-highlight select-none ${
            advancedOpen || activeFilterCount > 0
              ? "border-berkeley-blue bg-berkeley-blue text-white shadow-[0_2px_10px_rgba(0,50,98,0.25)]"
              : "border-slate-200 bg-white text-slate-700 active:bg-slate-50"
          }`}
        >
          Filters
          {activeFilterCount > 0 && (
            <span
              className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] ${advancedOpen ? "bg-white/20 text-white" : "bg-slate-100 text-slate-700"}`}
            >
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {advancedOpen && (
        <div className="animate-panel-in border-t border-slate-200/80 bg-white">
          <div className="container mx-auto space-y-4 px-4 py-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                  Filters
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  Category:{" "}
                  <span className="font-medium text-slate-800">
                    {filters.category}
                  </span>
                  <span className="mx-2 text-slate-300">•</span>
                  Source:{" "}
                  <span className="font-medium text-slate-800">
                    {selectedSource}
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAdvancedOpen(false)}
                className="select-none rounded-full px-3 py-1.5 text-sm font-semibold text-berkeley-blue tap-highlight active:bg-slate-100"
              >
                Done
              </button>
            </div>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                Category
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {Categories.map((category) => (
                  <button
                    key={category}
                    type="button"
                    onClick={() => onCategoryChange(category)}
                    className={`select-none rounded-full border px-3 py-1.5 text-sm tap-highlight ${
                      filters.category === category
                        ? "border-berkeley-blue bg-berkeley-blue text-white shadow-[0_2px_8px_rgba(0,50,98,0.2)]"
                        : "border-slate-200 bg-white text-slate-600 active:bg-slate-50"
                    }`}
                  >
                    {category}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                Source
              </p>
              <div className="mt-2">
                <SourceDropdown
                  value={filters.source}
                  options={sourceOptions}
                  onChange={onSourceChange}
                  tone="light"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
