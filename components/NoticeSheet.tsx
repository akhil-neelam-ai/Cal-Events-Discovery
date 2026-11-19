import { DESKTOP_HERO_PRESETS, DateRanges } from "../appConfig";
import type { QuickFilterPreset } from "../appConfig";
import { LoadingState, type SearchFilters } from "../types";
import { AgentHint } from "./AgentHint";
import { SearchField } from "./SearchField";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// Plain-language tooltips so the tabs (especially "All Events") are not
// ambiguous about the window they cover.
const DATE_RANGE_DESCRIPTIONS: Record<string, string> = {
  today: "Events happening today",
  week: "Events in the next 7 days",
  upcoming: "Every upcoming event on the calendar",
};

function keyParts(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(
    "en-US",
    { weekday: "long", timeZone: "UTC" },
  );
  return { month: MONTHS[month - 1] ?? "", day, weekday };
}

/** "Thursday, November 19" */
function longDate(dateKey: string): string {
  const { weekday, month, day } = keyParts(dateKey);
  return `${weekday}, ${month} ${day}`;
}

/** The small line on each tab: the days that range covers. */
function tabNote(range: string, todayKey: string, weekEndKey: string): string {
  const today = keyParts(todayKey);
  if (range === "today") {
    return `${today.weekday.slice(0, 3)}, ${today.month.slice(0, 3)} ${today.day}`;
  }
  if (range === "week") {
    const end = keyParts(weekEndKey);
    return end.month === today.month
      ? `${today.month.slice(0, 3)} ${today.day} to ${end.day}`
      : `${today.month.slice(0, 3)} ${today.day} to ${end.month.slice(0, 3)} ${end.day}`;
  }
  return "Everything ahead";
}

function tallyCopy(
  loading: LoadingState,
  allEventsCount: number,
  sourceCount: number,
): string {
  if (loading === LoadingState.ERROR) return "The latest events did not load.";
  if (loading !== LoadingState.SUCCESS) return "Loading the latest events.";
  if (allEventsCount === 0) {
    return "Search Berkeley events by topic, speaker, venue, or organizer.";
  }
  return `${allEventsCount.toLocaleString()} events from ${sourceCount} campus calendars.`;
}

/**
 * The plain white notice at the top of the wall: the wordmark, today's date,
 * the search blank, and a fringe of tear-off tabs for the date ranges.
 */
export function NoticeSheet({
  isMobile,
  todayKey,
  weekEndKey,
  loading,
  allEventsCount,
  sourceCount,
  searchQuery,
  activeDateRange,
  onSearchChange,
  onPresetSelect,
  onDateChange,
}: {
  isMobile: boolean;
  todayKey: string;
  weekEndKey: string;
  loading: LoadingState;
  allEventsCount: number;
  sourceCount: number;
  searchQuery: string;
  activeDateRange: SearchFilters["dateRange"];
  onSearchChange: (query: string) => void;
  onPresetSelect: (preset: QuickFilterPreset) => void;
  onDateChange: (next: SearchFilters["dateRange"]) => void;
}) {
  return (
    <header className="notice">
      <h1 className="mark">
        <span>Cal</span> <span>Events</span>
      </h1>
      <p className="dateline">{longDate(todayKey)}</p>
      <p className="tally">{tallyCopy(loading, allEventsCount, sourceCount)}</p>

      <SearchField searchQuery={searchQuery} onSearchChange={onSearchChange} />
      <AgentHint />

      {!isMobile && (
        <div className="try">
          <span>Try</span>
          {DESKTOP_HERO_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => onPresetSelect(preset)}
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}

      <div className="tabs" role="group" aria-label="Date range">
        {DateRanges.map((range) => (
          <button
            key={range.value}
            type="button"
            title={DATE_RANGE_DESCRIPTIONS[range.value]}
            aria-pressed={activeDateRange === range.value}
            onClick={() =>
              onDateChange(range.value as SearchFilters["dateRange"])
            }
          >
            <span className="dw" aria-hidden="true">
              {tabNote(range.value, todayKey, weekEndKey)}
            </span>
            <span className="dn">{range.label}</span>
          </button>
        ))}
      </div>
    </header>
  );
}
