/**
 * Normalization helpers shared across source adapters.
 * - Title cleanup
 * - Category inference (maps source-specific categories → frontend tags)
 * - Date / time projection from start_at + timezone for the legacy shape
 */

import he from "he";

import type { CanonicalEvent, LegacyCalEvent } from "./schema.js";

const FRONTEND_CATEGORIES = [
  "Academic",
  "Arts",
  "Sports",
  "Science & Tech",
  "Student Life",
  "Entrepreneurship",
] as const;
export type FrontendCategory = (typeof FRONTEND_CATEGORIES)[number];

// ─── Scoring weights ────────────────────────────────────────────────────────
// Higher weight = stronger signal. Organizer mapping is most reliable because
// it comes from a known entity, not free text that can contain red herrings.
const W_ORGANIZER_MAP = 100; // known department/org → category (highest confidence)
const W_SOURCE_TAG = 40; // source's own category label (trusted but sometimes broad)
const W_TITLE_KEYWORD = 10; // keyword found in event title
const W_ORGANIZER_KW = 8; // keyword found in organizer name (text, not mapping)
const W_DESC_KEYWORD = 3; // keyword found in description (weakest — lots of noise)

// ─── Organizer / source identity mapping ────────────────────────────────────
// Regex matched against organizer name and source identifier. First match wins
// per field — these are high-confidence mappings so they override keywords.
const ORGANIZER_MAP: Array<[RegExp, FrontendCategory]> = [
  [
    /\b(eecs|electrical engineering|computer science|simons institute|data science|statistics|bioengineering|computational|informatics)\b/i,
    "Science & Tech",
  ],
  [
    /\b(mathematics|math\b|physics|chemistry|biochemistry|molecular biology|neuroscience|astronomy|astrophysics|materials science|chemical engineering|civil engineering|mechanical engineering|nuclear engineering|industrial engineering)\b/i,
    "Science & Tech",
  ],
  [/\b(law school|berkeley law|school of law|jurisprudence)\b/i, "Academic"],
  [
    /\b(haas|school of business|business school|mba program)\b/i,
    "Entrepreneurship",
  ],
  [
    /\b(bampfa|cal performances|department of music|music department|art (history|practice)|theater|drama|dance|film)\b/i,
    "Arts",
  ],
  [
    /\b(athletics|cal bears|intercollegiate sports|recreational sports|intramural)\b/i,
    "Sports",
  ],
  [/\b(e-?hub|skydeck|lester center|entrepreneurship)\b/i, "Entrepreneurship"],
  [
    /\b(public health|epidemiology|social welfare|education|public policy|goldman school)\b/i,
    "Academic",
  ],
  // Student-services orgs. These reliably run community/social/sustainability
  // programming, not academic events, but their names contain generic words
  // ("center", "program") that would otherwise score as Academic. Listed last
  // so academic-discipline matches above still take priority.
  [
    /\b(serc|asuc|student (environmental|life|affairs|union|government|services|resource|advocate)|residential life|public service center|cal corps|basic needs|recreational? sports center|student learning center)\b/i,
    "Student Life",
  ],
];

// ─── Keyword lists per category ─────────────────────────────────────────────
// Each matched keyword adds its field weight to that category's score.
// Keywords are matched as whole words (word boundaries) in the lowercased text.
const KEYWORDS: Array<[FrontendCategory, string[]]> = [
  [
    "Science & Tech",
    [
      "ai",
      "machine learning",
      "deep learning",
      "data science",
      "computer science",
      "engineering",
      "robotics",
      "biotech",
      "genomics",
      "physics",
      "chemistry",
      "biology",
      "stem",
      "hackathon",
      "eecs",
      "computing",
      "nanotechnology",
      "neuroscience",
      "quantum",
      "semiconductor",
      "algorithm",
      "software",
      "hardware",
      "cybersecurity",
      "bioinformatics",
      "solid state",
      "photonics",
      "materials",
      "nanosystem",
      "convergent",
    ],
  ],
  [
    "Academic",
    [
      "seminar",
      "colloquium",
      "lecture",
      "symposium",
      "panel",
      "guest speaker",
      "dissertation",
      "defense",
      "research",
      "department",
      "institute",
      "center",
      "program",
      "advising",
      "lab",
      "laboratory",
      "office hours",
      "conference",
      "workshop",
      "talk",
      "forum",
      "roundtable",
      "thesis",
    ],
  ],
  [
    "Arts",
    [
      "concert",
      "recital",
      "performance",
      "exhibit",
      "exhibition",
      "gallery",
      "film",
      "screening",
      "theatre",
      "theater",
      "dance",
      "opera",
      "museum",
      "bampfa",
      "cal performances",
      "poetry",
      "art show",
      "installation",
      "documentary",
      "composer",
      "choreography",
    ],
  ],
  [
    "Sports",
    [
      "basketball",
      "football",
      "baseball",
      "softball",
      "soccer",
      "volleyball",
      "swim meet",
      "swim team",
      "track and field",
      "track meet",
      "track team",
      "tennis",
      "gymnastics",
      "water polo",
      "rugby",
      "lacrosse",
      "game vs",
      "cal bears",
      "intramural",
      "rec sports",
      "rowing",
      "crew team",
      "wrestling",
      "golf",
      "cross country",
      "field hockey",
    ],
  ],
  [
    "Entrepreneurship",
    [
      "startup",
      "entrepreneur",
      "founder",
      "venture",
      "pitch",
      "demo day",
      "skydeck",
      "e-hub",
      "product management",
      "innovation",
      "investment",
      "vc",
      "accelerator",
      "incubator",
      "angel investor",
      "seed funding",
      "go-to-market",
      "product launch",
      "market fit",
    ],
  ],
  [
    "Student Life",
    [
      "club",
      "social",
      "mixer",
      "orientation",
      "career fair",
      "networking",
      "student org",
      "grad student",
      "undergrad",
      "reception",
      "meetup",
      "tabling",
      "info session",
      "open house",
      "coffee chat",
      "retreat",
      "celebration",
      "commencement",
      "graduation",
      "wellness",
      "welcome week",
      "student association",
      "gsa",
      "asa",
      "dsp",
      "recycling",
      "reuse",
      "zero waste",
      "donation drive",
      "food pantry",
      "basic needs",
      "mutual aid",
      "move-out",
    ],
  ],
];

// Pre-build per-keyword regexes for counting multiple hits
const KEYWORD_INDIVIDUAL: Array<[FrontendCategory, RegExp[]]> = KEYWORDS.map(
  ([cat, words]) => [
    cat,
    words.map(
      (w) =>
        new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"),
    ),
  ],
);

function countMatches(text: string, patterns: RegExp[]): number {
  return patterns.reduce((sum, re) => {
    re.lastIndex = 0;
    const m = text.match(re);
    return sum + (m ? m.length : 0);
  }, 0);
}

// ─── Exact source-tag normalisation ─────────────────────────────────────────
const SOURCE_TAG_MAP: Record<string, FrontendCategory> = {
  academic: "Academic",
  academics: "Academic",
  arts: "Arts",
  art: "Arts",
  sports: "Sports",
  sport: "Sports",
  athletics: "Sports",
  "science & tech": "Science & Tech",
  "science and tech": "Science & Tech",
  science: "Science & Tech",
  tech: "Science & Tech",
  technology: "Science & Tech",
  entrepreneurship: "Entrepreneurship",
  entrepreneur: "Entrepreneurship",
  business: "Entrepreneurship",
  "student life": "Student Life",
  student: "Student Life",
};

function scoreEvent(event: {
  title: string;
  description: string;
  categories: string[];
  organizer: string;
}): Map<FrontendCategory, number> {
  const scores = new Map<FrontendCategory, number>(
    FRONTEND_CATEGORIES.map((c) => [c, 0]),
  );

  const add = (cat: FrontendCategory, weight: number) =>
    scores.set(cat, (scores.get(cat) ?? 0) + weight);

  // 1. Organizer identity mapping (highest confidence)
  for (const [pattern, cat] of ORGANIZER_MAP) {
    if (pattern.test(event.organizer)) {
      add(cat, W_ORGANIZER_MAP);
      break; // one organizer map match is enough
    }
  }

  // 2. Source tag exact match
  for (const tag of event.categories) {
    const mapped = SOURCE_TAG_MAP[tag.trim().toLowerCase()];
    if (mapped) add(mapped, W_SOURCE_TAG);
  }

  // 3. Keyword scoring: title (high), organizer text (medium), description (low)
  for (const [cat, patterns] of KEYWORD_INDIVIDUAL) {
    const titleHits = countMatches(event.title, patterns);
    const orgHits = countMatches(event.organizer, patterns);
    const descHits = countMatches(event.description, patterns);
    if (titleHits) add(cat, titleHits * W_TITLE_KEYWORD);
    if (orgHits) add(cat, orgHits * W_ORGANIZER_KW);
    if (descHits) add(cat, descHits * W_DESC_KEYWORD);
  }

  return scores;
}

export function deriveFrontendTags(event: {
  title: string;
  description: string;
  categories: string[];
  organizer: string;
}): FrontendCategory[] {
  const scores = scoreEvent(event);
  // Sort by score descending; only include categories with score > 0
  return ([...scores.entries()] as [FrontendCategory, number][])
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([cat]) => cat);
}

export function inferCategory(event: {
  title: string;
  description: string;
  categories: string[];
  organizer: string;
}): FrontendCategory {
  return deriveFrontendTags(event)[0] ?? "Student Life";
}

// Keep for legacy call sites that pass a pre-built tag array
function dedupeOrderedTags(tags: FrontendCategory[]): FrontendCategory[] {
  // Preserve original order but deduplicate
  return [
    ...new Set(
      tags.filter((t): t is FrontendCategory =>
        FRONTEND_CATEGORIES.includes(t as FrontendCategory),
      ),
    ),
  ];
}

export function cleanTitle(raw: string): string {
  return sanitizePlainText(raw)
    .replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, "")
    .trim();
}

export function sanitizePlainText(raw: string): string {
  const withoutTags = raw.replace(/<[^>]+>/g, " ");
  const decoded = he.decode(withoutTags);
  return decoded.replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
}

const TZ = "America/Los_Angeles";

export function isoDateInPT(start_at: string): string {
  // For all-day VEVENTs, start_at is YYYY-MM-DD already.
  if (/^\d{4}-\d{2}-\d{2}$/.test(start_at)) return start_at;
  const d = new Date(start_at);
  if (isNaN(d.getTime())) return "";
  // Use Intl to get the date in Pacific time (handles DST)
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(d); // en-CA gives YYYY-MM-DD
}

export function displayTime(start_at: string, all_day: boolean): string {
  if (all_day) return "All day";
  if (/^\d{4}-\d{2}-\d{2}$/.test(start_at)) return "All day";
  const d = new Date(start_at);
  if (isNaN(d.getTime())) return "TBD";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

export function projectToLegacy(event: CanonicalEvent): LegacyCalEvent {
  const date = isoDateInPT(event.start_at);
  const time = displayTime(event.start_at, event.all_day);
  const location =
    [event.venue, event.building].filter(Boolean).join(" — ") ||
    event.address ||
    "Berkeley, CA";
  const tags =
    event.tags.length > 0
      ? dedupeOrderedTags(event.tags as FrontendCategory[])
      : deriveFrontendTags(event);
  const id = `${event.source_name}_${event.source_id}`;
  const legacy: LegacyCalEvent = {
    id,
    title: cleanTitle(event.title),
    organizer: event.organizer || event.organizer_unit || "UC Berkeley",
    date,
    time,
    location,
    description: sanitizePlainText(event.description || event.title),
    tags: tags.length > 0 ? tags : [inferCategory(event)],
    url: event.canonical_url || event.source_url,
    source: event.source_name,
  };

  // Multi-day events carry their full upcoming occurrence list (set by
  // collapseMultiDay). `date` is the earliest of those; `end_date` is the last.
  if (event.occurrence_dates && event.occurrence_dates.length > 1) {
    const dates = [...event.occurrence_dates].sort();
    legacy.dates = dates;
    legacy.end_date = event.end_at
      ? isoDateInPT(event.end_at)
      : dates[dates.length - 1];
  }

  return legacy;
}

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "in",
  "on",
  "at",
  "to",
  "for",
  "with",
  "by",
  "from",
  "is",
  "as",
  "vs",
  "vs.",
  "&",
]);

export function normalizeForDedupe(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w))
    .join(" ");
}
