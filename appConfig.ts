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
  cltc: "Center for Long-Term Cybersecurity",
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
  ai_risk: "https://ai-risk.berkeley.edu/#upcoming",
  brsl: "https://brsl.berkeley.edu/events/",
  cltc: "https://cltc.berkeley.edu/events/",
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
  "cltc",
];
// Sources no longer fetched. Their ids stay in ALL_SOURCES so old links still
// parse. scripts/lib/schema.ts keeps its own copy, and a test holds them equal.
export const RETIRED_SOURCES: readonly string[] = ["callink"];
// Sources an agent or a filter control can offer.
export const ACTIVE_SOURCES: readonly string[] = ALL_SOURCES.filter(
  (source) => source !== "All" && !RETIRED_SOURCES.includes(source),
);
export const DateRanges = [
  { label: "Today", value: "today" },
  { label: "This Week", value: "week" },
  { label: "All Events", value: "upcoming" },
];

export const TOPIC_GROUP_PRESENTATION = [
  { value: "fields", label: "Fields" },
  { value: "interests", label: "Interests" },
] as const;

export const COLLAPSED_TOPICS_PER_GROUP = 4;

export const DEFAULT_FILTERS: SearchFilters = {
  dateRange: "week",
  category: "All",
  topic: "",
  searchQuery: "",
  source: "All",
};

export const VISIBLE_EVENT_BATCH_SIZE = 72;

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

/**
 * The prompt the notice's card hands visitors for their own AI assistant.
 * The owner approved this text. It asks at most two questions, never about
 * availability, and points the assistant at the day pages (/days/).
 */
export const AGENT_PROMPT = `Help me keep up with UC Berkeley events I'd enjoy, using CalEvents (https://cal-events.com).

1. Read https://cal-events.com/llms.txt first.
2. Ask me two things in one message: "What kind of events would you like?" and "Do you want a daily digest, a weekly digest, or one a few times a week?"
3. Read the day pages listed at https://cal-events.com/days/index.txt for the days your digest covers. Only suggest events you find there.
4. Send me the events that fit best, and leave out weak matches. For each, give the title, day and time, place, one line on why it fits, and its link.
5. If you can schedule tasks, repeat this at the pace I chose. If you can't, tell me, and I'll ask again when I want the next one.`;
