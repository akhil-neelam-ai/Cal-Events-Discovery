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

// Words that may sit inside a capitalized anchor, as in "Center for Latin
// American Studies".
const ANCHOR_CONNECTORS = new Set([
  "a",
  "an",
  "and",
  "at",
  "for",
  "in",
  "of",
  "on",
  "the",
  "to",
  "&",
]);
const ARTICLES = new Set(["a", "an", "the"]);
const MAX_ANCHOR_WORDS = 8;
// Anchor text never crosses sentence punctuation, quotes, or a line break.
const ANCHOR_BOUNDARY_RE = /[.,;:!?()[\]|"“”…—–\n\u200B-\u200D\uFEFF]/;

// A dot inside "music.berkeley.edu" or "3.5" is part of a word.
function isAnchorBoundary(text: string, index: number): boolean {
  if (
    text[index] === "." &&
    /[a-z0-9]/.test(text[index - 1] ?? "") &&
    /[a-z0-9]/.test(text[index + 1] ?? "")
  ) {
    return false;
  }
  return ANCHOR_BOUNDARY_RE.test(text[index]);
}

/** The words before a printed "(url)" that the source page showed as the link. */
function trailingAnchorText(text: string): string {
  let start = text.length;
  while (start > 0 && !isAnchorBoundary(text, start - 1)) start--;
  const words = [...text.slice(start).matchAll(/\S+/g)];
  if (words.length === 0) return "";

  // Walk back over capitalized words and the connectors between them.
  let first = words.length;
  for (
    let i = words.length - 1;
    i >= 0 && words.length - i <= MAX_ANCHOR_WORDS;
    i--
  ) {
    const word = words[i][0];
    const lower = word.toLowerCase();
    if (/^[\p{Lu}\p{N}]/u.test(word)) first = i;
    else if (first === words.length || !ANCHOR_CONNECTORS.has(lower)) break;
    // "of the" stays inside an anchor; "Visit the" ends it.
    else if (
      ARTICLES.has(lower) &&
      !ANCHOR_CONNECTORS.has(words[i - 1]?.[0].toLowerCase() ?? "")
    )
      break;
  }
  // A lowercase anchor, as in "register here (url)", is its last word.
  if (first === words.length) {
    first = words.length - 1;
    if (!/\p{L}/u.test(words[first][0])) return "";
  }
  return text.slice(start + (words[first].index ?? 0));
}

// Drop the ")" and keep a break before glued text, as in "(url)PARKING".
function closeParenthetical(text: string): string {
  const rest = text.replace(/^\s*\)/, "");
  if (/^\p{Lu}\p{L}/u.test(rest)) return `\n${rest}`;
  if (/^[\p{L}\p{N}]/u.test(rest)) return ` ${rest}`;
  return rest;
}

/**
 * Runs for display. LiveWhale prints each link as "anchor text (url)". This
 * links the anchor words and drops the printed URL, the way the source page
 * shows it. A "(mailto:x)" right after the linked address x is dropped.
 */
export function displaySegments(text: string): TextSegment[] {
  const input = linkifySegments(text);
  const out: TextSegment[] = [];

  for (let i = 0; i < input.length; i++) {
    const segment = input[i];
    const previous = out[out.length - 1];
    const next = input[i + 1];
    if (
      segment.kind !== "link" ||
      previous?.kind !== "text" ||
      next?.kind !== "text" ||
      !/\(\s*$/.test(previous.text) ||
      !/^\s*\)/.test(next.text)
    ) {
      out.push(segment);
      continue;
    }

    const before = previous.text.replace(/\s*\(\s*$/, "");
    const linkBefore = out[out.length - 2];
    const address = segment.href.startsWith("mailto:")
      ? segment.href.slice("mailto:".length)
      : "";
    const repeatsLink =
      before.trim() === "" &&
      linkBefore?.kind === "link" &&
      (linkBefore.href === segment.href ||
        (address !== "" &&
          linkBefore.text.toLowerCase().endsWith(address.toLowerCase())));
    if (repeatsLink && linkBefore.href !== segment.href) {
      // The feed glued a word onto the address ("atjane@x.edu"). The
      // printed mailto has it right, so split the word back off.
      const prefix = linkBefore.text.slice(0, -address.length);
      out.splice(
        out.length - 2,
        1,
        { kind: "text", text: `${prefix} ` },
        { kind: "link", text: address, href: segment.href },
      );
    }
    const anchor = repeatsLink ? "" : trailingAnchorText(before);
    if (!repeatsLink && !anchor) {
      out.push(segment);
      continue;
    }

    out.pop();
    const head = before.slice(0, before.length - anchor.length);
    if (head) out.push({ kind: "text", text: head });
    if (anchor) out.push({ kind: "link", text: anchor, href: segment.href });
    input[i + 1] = { kind: "text", text: closeParenthetical(next.text) };
  }

  return out.filter((segment) => segment.text !== "");
}
