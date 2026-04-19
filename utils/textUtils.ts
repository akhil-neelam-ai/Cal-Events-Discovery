/**
 * Core text processing — no external deps.
 * Used by both the browser search engine and the build-time index builder.
 */

/**
 * Compact field-differentiated inverted index.
 * Uses numeric positions into `ids` instead of string event IDs to reduce JSON size ~5x.
 *
 * t = title (weight 60)  g = tags (weight 45)  o = organizer (weight 30)  d = desc (weight 10)
 */
export interface SearchIndex {
  ids: string[];                    // position → eventId lookup table
  t:   Record<string, number[]>;   // title stem → [pos, ...]
  g:   Record<string, number[]>;   // tag stem   → [pos, ...]
  o:   Record<string, number[]>;   // org stem   → [pos, ...]
  d:   Record<string, number[]>;   // desc stem  → [pos, ...]
  buildAt: string;
  eventCount: number;
}

const STOP_WORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with','by',
  'from','is','are','was','were','be','been','being','have','has','had','do',
  'does','did','will','would','could','should','may','might','can','this',
  'that','these','those','it','its','about','as','into','through','during',
  'before','after','up','down','out','off','over','under','then','once','how',
  'what','when','where','who','which','more','our','their','your','my','all',
  'each','every','both','few','most','other','some','such','than','too','very',
  'also','just','only','even','here','there','no','not','so','if','us',
]);

/**
 * Porter-lite stemmer: strips the most common English suffixes.
 * Consistent output is more important than perfection — both the index and
 * query must be stemmed the same way.
 */
export function stem(word: string): string {
  let w = word;
  if (w.length <= 3) return w;

  // Step 1a — plurals
  if (w.endsWith('sses') && w.length > 6) {
    w = w.slice(0, -2);                              // classes → class
  } else if (w.endsWith('ies') && w.length > 4) {
    w = w.slice(0, -3) + 'i';                       // parties → parti
  } else if (!w.endsWith('ss') && !w.endsWith('us') && w.endsWith('s') && w.length > 4) {
    w = w.slice(0, -1);                             // talks → talk
  }
  if (w.length <= 3) return w;

  // Step 1b — -ing / -ed
  if (w.endsWith('ing') && w.length > 6) {
    const base = w.slice(0, -3);
    if (base.length >= 3) {
      // running → runn → run (double consonant collapse)
      if (base.length >= 4 && /([bcdfghjklmnpqrstvwxyz])\1$/.test(base)) {
        w = base.slice(0, -1);
      } else {
        w = base;
      }
    }
  } else if (w.endsWith('ed') && w.length > 5) {
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
  for (const raw of text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)) {
    if (raw.length < 2 || STOP_WORDS.has(raw)) continue;
    const s = stem(raw);
    if (s.length >= 2 && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}
