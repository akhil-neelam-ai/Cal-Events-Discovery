/**
 * Core text processing — no external deps.
 * Used by both the browser search engine and the build-time index builder.
 */

/**
 * Compact field-differentiated inverted index.
 * t = title (weight 60)  g = tags (weight 45)  o = organizer (weight 30)
 * d = desc (weight 10)   l = location (weight 20)
 */
export interface SearchIndex {
  ids: string[];
  t: Record<string, number[]>;
  g: Record<string, number[]>;
  o: Record<string, number[]>;
  d: Record<string, number[]>;
  l: Record<string, number[]>;
  buildAt: string;
  eventCount: number;
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "can",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
  "about",
  "as",
  "into",
  "through",
  "during",
  "before",
  "after",
  "up",
  "down",
  "out",
  "off",
  "over",
  "under",
  "then",
  "once",
  "how",
  "what",
  "when",
  "where",
  "who",
  "which",
  "more",
  "our",
  "their",
  "your",
  "my",
  "all",
  "each",
  "every",
  "both",
  "few",
  "most",
  "other",
  "some",
  "such",
  "than",
  "too",
  "very",
  "also",
  "just",
  "only",
  "even",
  "here",
  "there",
  "no",
  "not",
  "so",
  "if",
  "us",
]);

/**
 * Porter-lite stemmer.
 * Consistent output is more important than perfection — both the index and
 * query must be stemmed the same way.
 */
export function stem(word: string): string {
  let w = word;
  if (w.length <= 3) return w;

  if (w.endsWith("sses") && w.length > 6) {
    w = w.slice(0, -2);
  } else if (w.endsWith("ies") && w.length > 4) {
    w = w.slice(0, -3) + "i";
  } else if (
    !w.endsWith("ss") &&
    !w.endsWith("us") &&
    w.endsWith("s") &&
    w.length > 4
  ) {
    w = w.slice(0, -1);
  }
  if (w.length <= 3) return w;

  if (w.endsWith("ing") && w.length > 6) {
    const base = w.slice(0, -3);
    if (base.length >= 3) {
      if (base.length >= 4 && /([bcdfghjklmnpqrstvwxyz])\1$/.test(base)) {
        w = base.slice(0, -1);
      } else {
        w = base;
      }
    }
  } else if (w.endsWith("ed") && w.length > 5) {
    const base = w.slice(0, -2);
    if (base.length >= 3) {
      if (base.length >= 4 && /([bcdfghjklmnpqrstvwxyz])\1$/.test(base)) {
        w = base.slice(0, -1);
      } else {
        w = base;
      }
    }
  }

  return w;
}

/** Split text into stemmed, deduplicated tokens suitable for indexing/querying. */
export function tokenize(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)) {
    if (raw.length < 2 || STOP_WORDS.has(raw)) continue;
    const s = stem(raw);
    if (s.length >= 2 && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

// ─── Domain synonym map ───────────────────────────────────────────────────────
// Keys may be multi-word phrases (checked via substring) or single words (checked via tokens).

export const DOMAIN_SYNONYMS: Record<string, string[]> = {
  // Entrepreneurship
  startup: ["entrepreneurship", "founder", "venture", "pitch", "skydeck"],
  founder: ["startup", "entrepreneur", "venture", "pitch"],
  venture: ["startup", "founder", "entrepreneur"],
  // Arts / Media
  film: ["movie", "screening", "cinema", "documentary"],
  movie: ["film", "screening", "cinema"],
  concert: ["music", "recital", "performance", "band", "orchestra"],
  music: ["concert", "recital", "performance"],
  // Academic
  talk: ["lecture", "seminar", "speaker", "panel", "discussion", "colloquium"],
  lecture: ["talk", "seminar", "speaker", "panel"],
  seminar: ["talk", "lecture", "speaker", "panel"],
  workshop: ["class", "training", "hands-on", "session"],
  // Career / Student life
  career: ["job", "recruiting", "internship", "networking", "professional"],
  networking: ["career", "job", "professional", "mixer", "reception"],
  // Food
  "free food": [
    "pizza",
    "snacks",
    "refreshments",
    "reception",
    "lunch",
    "dinner",
  ],
  // Generic vague
  fun: ["social", "performance", "game", "festival", "party", "arts"],
  interesting: ["talk", "lecture", "workshop", "exhibition", "seminar"],
  code: ["programming", "hackathon", "engineering", "software", "cs"],
  // Sports
  game: [
    "basketball",
    "football",
    "baseball",
    "volleyball",
    "soccer",
    "athletics",
  ],
  sports: ["athletics", "basketball", "football", "baseball", "volleyball"],
};

// ─── Berkeley venue / building aliases ───────────────────────────────────────
// Used in buildIndex.ts to add alias tokens alongside real location text,
// and in searchEngine.ts to expand queries mentioning these venues.

export const BERKELEY_VENUE_ALIASES: Record<string, string> = {
  bampfa: "arts film museum cinema gallery",
  moffitt: "library study moffitt",
  "doe library": "library research doe",
  mlk: "student union meeting",
  rsf: "gym fitness recreation sports wellness",
  haas: "business school management haas",
  sproul: "plaza outdoor student",
  "memorial glade": "outdoor event lawn",
  soda: "computer science engineering cs",
  "cory hall": "electrical engineering eecs",
  "stanley hall": "biology bioengineering health",
  "mulford hall": "environmental science biology",
  dwinelle: "humanities languages",
  wheeler: "english history humanities",
  northside: "north campus residential",
  southside: "south campus telegraph",
};
