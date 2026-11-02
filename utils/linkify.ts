export type TextSegment =
  { kind: "text"; text: string } | { kind: "link"; text: string; href: string };

// A URL stops at whitespace, brackets, and quotes. Source text often wraps a
// link in parentheses and glues the next word on: "(https://x.edu/a)PARKING".
// An email may carry a "mailto:" prefix, which the feeds print as plain text.
const LINK_RE =
  /\b(?:https?:\/\/|www\.)[^\s()<>"']+|(?:mailto:)?[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gi;
const TRAILING_PUNCTUATION_RE = /[.,;:!?]+$/;

function toHref(raw: string): string {
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^www\./i.test(raw)) return `https://${raw}`;
  if (/^mailto:/i.test(raw)) return `mailto:${raw.slice("mailto:".length)}`;
  return `mailto:${raw}`;
}

/** Split plain text into text and link runs. Hrefs are only http(s) or mailto. */
export function linkifySegments(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(LINK_RE)) {
    const trailing = match[0].match(TRAILING_PUNCTUATION_RE)?.[0] ?? "";
    const raw = match[0].slice(0, match[0].length - trailing.length);
    if (!raw) continue;

    if (match.index > cursor) {
      segments.push({ kind: "text", text: text.slice(cursor, match.index) });
    }
    segments.push({ kind: "link", text: raw, href: toHref(raw) });
    cursor = match.index + raw.length;
  }

  if (cursor < text.length) {
    segments.push({ kind: "text", text: text.slice(cursor) });
  }
  return segments;
}
