import type { SearchFilters } from "./types";

export const SOURCE_LABELS: Record<string, string> = {
  livewhale: "UC Berkeley Events",
  cal_performances: "Cal Performances",
  bampfa: "BAMPFA",
  calbears: "Cal Bears",
  callink: "CalLink",
  haas: "Berkeley Haas",
  berkeley_law: "Berkeley Law",
  simons: "Simons Institute",
  luma: "Luma",
  begin: "Berkeley BEGIN",
  ai_risk: "Berkeley AI Risk",
  brsl: "Berkeley Risk and Security Lab",
};

export const SOURCE_URLS: Record<string, string> = {
  livewhale: "https://events.berkeley.edu",
  cal_performances: "https://calperformances.org",
  bampfa: "https://bampfa.org/events",
  calbears: "https://calbears.com/calendar",
  callink: "https://callink.berkeley.edu/events",
  haas: "https://haas.berkeley.edu/events/",
  berkeley_law: "https://www.law.berkeley.edu/events/",
  simons: "https://simons.berkeley.edu/programs-events",
  luma: "https://luma.com/discover",
  begin: "https://begin.berkeley.edu/events/",
  ai_risk: "https://ai-risk.berkeley.edu/speaker-series.html",
  brsl: "https://brsl.berkeley.edu/events/",
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
  "cal_performances",
  "bampfa",
  "calbears",
  "callink",
  "haas",
  "berkeley_law",
  "simons",
  "luma",
  "begin",
  "ai_risk",
  "brsl",
];
export const DateRanges = [
  { label: "Today", value: "today" },
  { label: "This Week", value: "week" },
  { label: "All Events", value: "upcoming" },
];

export const DEFAULT_FILTERS: SearchFilters = {
  dateRange: "week",
  category: "All",
  topic: "",
  searchQuery: "",
  source: "All",
};

export const VISIBLE_EVENT_BATCH_SIZE = 72;

export const FEED_CADENCE_COPY = "Updates everyday";

// Natural-language example queries shown as chips below the hero search bar.
// Each sets a sensible scope plus a query the client search engine interprets.
export const DESKTOP_HERO_PRESETS: QuickFilterPreset[] = [
  {
    label: "What's on tonight?",
    dateRange: "today",
    category: "All",
    searchQuery: "tonight",
  },
  {
    label: "AI talks",
    dateRange: "week",
    category: "All",
    searchQuery: "ai",
  },
  {
    label: "A film at BAMPFA",
    dateRange: "upcoming",
    category: "Arts",
    searchQuery: "bampfa film",
  },
  {
    label: "Something this weekend",
    dateRange: "week",
    category: "All",
    searchQuery: "this weekend",
  },
  {
    label: "A Cal game",
    dateRange: "week",
    category: "Sports",
    searchQuery: "cal game",
  },
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
