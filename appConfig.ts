import type { SearchFilters } from "./types";

export const SOURCE_LABELS: Record<string, string> = {
  livewhale: "UC Berkeley Events",
  ehub: "Berkeley E-Hub",
  gemini: "Discovered",
  cal_performances: "Cal Performances",
  bampfa: "BAMPFA",
  calbears: "Cal Bears",
  callink: "CalLink",
  haas: "Berkeley Haas",
  berkeley_law: "Berkeley Law",
  simons: "Simons Institute",
};

export const SOURCE_URLS: Record<string, string> = {
  livewhale: "https://events.berkeley.edu",
  ehub: "https://ehub.berkeley.edu/events/",
  cal_performances: "https://calperformances.org",
  bampfa: "https://bampfa.org/events",
  calbears: "https://calbears.com/calendar",
  callink: "https://callink.berkeley.edu/events",
  haas: "https://haas.berkeley.edu/events/",
  berkeley_law: "https://www.law.berkeley.edu/events/",
  simons: "https://simons.berkeley.edu/programs-events",
};

export interface SourceOption {
  value: string;
  label: string;
  count: number;
}

export interface QuickFilterPreset {
  label: string;
  dateRange: SearchFilters["dateRange"];
  category: string;
  searchQuery: string;
}

export const Categories = [
  "All",
  "Academic",
  "Arts",
  "Sports",
  "Science & Tech",
  "Student Life",
  "Entrepreneurship",
];
export const ALL_SOURCES = [
  "All",
  "livewhale",
  "ehub",
  "gemini",
  "cal_performances",
  "bampfa",
  "calbears",
  "callink",
  "haas",
  "berkeley_law",
  "simons",
];
export const DateRanges = [
  { label: "Today", value: "today" },
  { label: "This Week", value: "week" },
  { label: "All Events", value: "upcoming" },
];

export const DEFAULT_FILTERS: SearchFilters = {
  dateRange: "today",
  category: "All",
  searchQuery: "",
  source: "All",
};

export const VISIBLE_EVENT_BATCH_SIZE = 72;

export const DESKTOP_HERO_PRESETS: QuickFilterPreset[] = [
  {
    label: "Tonight",
    dateRange: "today",
    category: "All",
    searchQuery: "tonight",
  },
  {
    label: "AI talks",
    dateRange: "week",
    category: "Science & Tech",
    searchQuery: "ai",
  },
  {
    label: "Cal games",
    dateRange: "week",
    category: "Sports",
    searchQuery: "",
  },
  { label: "This week", dateRange: "week", category: "All", searchQuery: "" },
];

export const POPULAR_SEARCHES = [
  "AI",
  "Film screening",
  "Cal games",
  "Free food",
  "Speaker",
  "Workshop",
  "Wellness",
];

export const CAL_PHRASES: Array<{ plain: string; gold: string }> = [
  { plain: "Go Bears.", gold: "What's the move?" },
  { plain: "Oski says", gold: "something's happening." },
  { plain: "Bear territory.", gold: "What are you into?" },
  { plain: "It's a good day", gold: "to be a Bear." },
];
