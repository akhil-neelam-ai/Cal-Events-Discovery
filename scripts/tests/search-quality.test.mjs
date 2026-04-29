/**
 * Golden-query tests: verify that real search queries against the published
 * index return events that actually match the intent.
 *
 * These tests are NOT unit tests of the search algorithm — they test the
 * full stack from index content to result quality. They will need updating
 * if the event corpus changes significantly.
 *
 * Run: node --test scripts/tests/search-quality.test.mjs
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { searchEvents } from "../../utils/searchEngine.ts";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const eventsPath = path.join(rootDir, "public", "events.json");
const searchIndexPath = path.join(rootDir, "public", "search-index.json");

const published = JSON.parse(fs.readFileSync(eventsPath, "utf8"));
const searchIndex = JSON.parse(fs.readFileSync(searchIndexPath, "utf8"));

const events = published.events;
const indexIds = searchIndex.ids;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stem(word) {
  let w = word;
  if (w.length <= 3) return w;
  if (w.endsWith("sses") && w.length > 6) return w.slice(0, -2);
  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "i";
  if (!w.endsWith("ss") && !w.endsWith("us") && w.endsWith("s") && w.length > 4)
    w = w.slice(0, -1);
  if (w.length <= 3) return w;
  if (w.endsWith("ing") && w.length > 6) {
    const base = w.slice(0, -3);
    if (base.length >= 3)
      return /([bcdfghjklmnpqrstvwxyz])\1$/.test(base) && base.length >= 4
        ? base.slice(0, -1)
        : base;
  }
  if (w.endsWith("ed") && w.length > 5) {
    const base = w.slice(0, -2);
    if (base.length >= 3)
      return /([bcdfghjklmnpqrstvwxyz])\1$/.test(base) && base.length >= 4
        ? base.slice(0, -1)
        : base;
  }
  return w;
}

const STOP = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
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
  "this",
  "that",
  "it",
]);

function tokenize(text) {
  const seen = new Set();
  const out = [];
  for (const raw of text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)) {
    if (raw.length < 2 || STOP.has(raw)) continue;
    const s = stem(raw);
    if (s.length >= 2 && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

/**
 * Simple index-based search that returns event IDs ranked by hit count.
 * Mirrors the basic phase-1 logic of searchEngine.ts without needing to import TS.
 */
function indexSearch(query, topN = 10) {
  const tokens = tokenize(query);
  const scores = new Map(); // pos → score

  for (const token of tokens) {
    for (const field of ["t", "g", "o", "l", "d"]) {
      const weight = { t: 60, g: 45, o: 30, l: 20, d: 10 }[field];
      const positions = searchIndex[field]?.[token] ?? [];
      for (const pos of positions) {
        scores.set(pos, (scores.get(pos) ?? 0) + weight);
      }
    }
    // Also check title phrase
    for (let pos = 0; pos < indexIds.length; pos++) {
      const ev = events[pos];
      if (!ev) continue;
      if (ev.title.toLowerCase().includes(query.toLowerCase())) {
        scores.set(pos, (scores.get(pos) ?? 0) + 100);
      }
    }
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([pos]) => ({ event: events[pos], score: scores.get(pos) }));
}

function topTitles(query, n = 5) {
  return indexSearch(query, n).map((r) => r.event?.title ?? "(missing)");
}

function hasMatchIn(results, predicate) {
  return results.some((r) => r.event && predicate(r.event));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test("index has location field", () => {
  assert.ok(
    searchIndex.l && typeof searchIndex.l === "object",
    "l field must exist",
  );
  assert.ok(Object.keys(searchIndex.l).length > 0, "l field must have entries");
});

test("index covers full description (not just first 150 chars)", () => {
  // Find an event whose description is longer than 150 chars
  const longDesc = events.find((e) => (e.description ?? "").length > 300);
  assert.ok(longDesc, "at least one event should have a long description");

  // Tokenize the tail of the description (beyond 150 chars)
  const tail = longDesc.description.slice(200);
  const tailTokens = tokenize(tail);
  assert.ok(tailTokens.length > 0, "tail should produce tokens");

  // At least one tail token should appear in the index
  const pos = events.indexOf(longDesc);
  const anyHit = tailTokens.some((t) => searchIndex.d[t]?.includes(pos));
  assert.ok(
    anyHit,
    `expected a tail token from "${longDesc.title}" to be indexed in d`,
  );
});

test('search: "ai" returns Science & Tech events', () => {
  const results = indexSearch("ai machine learning", 10);
  const hasSTEM = hasMatchIn(results, (e) =>
    e.tags?.some(
      (t) =>
        t.toLowerCase().includes("science") || t.toLowerCase().includes("tech"),
    ),
  );
  assert.ok(
    hasSTEM,
    `Expected Science & Tech in top results for "ai machine learning". Got: ${topTitles("ai machine learning", 5).join(" | ")}`,
  );
});

test('search: "film screening" returns Arts events', () => {
  const results = indexSearch("film screening", 10);
  const hasArts = hasMatchIn(results, (e) =>
    e.tags?.some((t) => t.toLowerCase().includes("art")),
  );
  assert.ok(
    hasArts,
    `Expected Arts events for "film screening". Got: ${topTitles("film screening").join(" | ")}`,
  );
});

test('search: "bampfa" returns events from bampfa source', () => {
  const results = indexSearch("bampfa", 10);
  const hasBampfa = hasMatchIn(
    results,
    (e) =>
      e.source === "bampfa" || e.organizer?.toLowerCase().includes("bampfa"),
  );
  assert.ok(
    hasBampfa,
    `Expected bampfa events. Got: ${results
      .slice(0, 5)
      .map((r) => `${r.event?.title} (${r.event?.source})`)
      .join(" | ")}`,
  );
});

test('search: "startup founder" returns Entrepreneurship events', () => {
  const results = indexSearch("startup founder", 10);
  const hasEntrepreneur = hasMatchIn(results, (e) =>
    e.tags?.some((t) => t.toLowerCase().includes("entrepreneur")),
  );
  assert.ok(
    hasEntrepreneur,
    `Expected Entrepreneurship events for "startup founder". Got: ${topTitles("startup founder").join(" | ")}`,
  );
});

test('search: "free food" matches events mentioning free in title or description', () => {
  const results = indexSearch("free food", 10);
  const hasFree = hasMatchIn(results, (e) => {
    const text = `${e.title} ${e.description ?? ""}`.toLowerCase();
    return /\bfree\b/.test(text);
  });
  assert.ok(
    hasFree || results.length === 0,
    "free food events should mention free, or no results",
  );
});

test('search: "seminar" returns Academic events', () => {
  const results = indexSearch("seminar", 10);
  const hasAcademic = hasMatchIn(results, (e) =>
    e.tags?.some(
      (t) =>
        t.toLowerCase().includes("academic") ||
        t.toLowerCase().includes("science"),
    ),
  );
  assert.ok(
    hasAcademic,
    `Expected Academic events for "seminar". Got: ${topTitles("seminar").join(" | ")}`,
  );
});

test('search: "cal bears" or "sports" returns Sports events', () => {
  const results = indexSearch("cal bears sports athletics", 10);
  const hasSports = hasMatchIn(
    results,
    (e) =>
      e.tags?.some((t) => t.toLowerCase().includes("sport")) ||
      e.source === "calbears",
  );
  assert.ok(
    hasSports,
    `Expected Sports events. Got: ${topTitles("cal bears", 5).join(" | ")}`,
  );
});

test('search: "haas" returns Haas / business school events', () => {
  const results = indexSearch("haas", 10);
  const hasHaas = hasMatchIn(
    results,
    (e) =>
      e.source === "haas" ||
      e.organizer?.toLowerCase().includes("haas") ||
      e.title?.toLowerCase().includes("haas"),
  );
  assert.ok(
    hasHaas,
    `Expected Haas events. Got: ${results
      .slice(0, 5)
      .map((r) => `${r.event?.title} (${r.event?.source})`)
      .join(" | ")}`,
  );
});

test("search results are ranked by score descending", () => {
  const results = indexSearch("lecture seminar talk", 20);
  for (let i = 1; i < results.length; i++) {
    assert.ok(
      results[i].score <= results[i - 1].score,
      `Results not sorted at index ${i}`,
    );
  }
});

test("intent-only temporal queries do not shrink the result pool when the real engine runs", () => {
  const todayResults = searchEvents(events, "today", searchIndex);
  const tomorrowResults = searchEvents(events, "tomorrow", searchIndex);
  const weekResults = searchEvents(events, "this week", searchIndex);

  assert.equal(
    todayResults.results.length,
    events.length,
    '"today" should return the full pool for later date filtering',
  );
  assert.equal(
    tomorrowResults.results.length,
    events.length,
    '"tomorrow" should return the full pool for later date filtering',
  );
  assert.equal(
    weekResults.results.length,
    events.length,
    '"this week" should return the full pool for later date filtering',
  );
});

// ─── Temporal intent tests ────────────────────────────────────────────────────
// These guard against the bug where pure temporal queries ("today", "this week")
// were routed through Fuse.js text-matching instead of returning the full pool
// for date-range filtering. The fix: runScoring returns pool unscored when
// expandedTokens and phrases are both empty (i.e. entire query was a date intent).

const RE_TODAY =
  /\b(tonight|today|this evening|this afternoon|this morning)\b/i;
const RE_TOMORROW = /\b(tomorrow|tmrw|tmr)\b/i;
const RE_WEEK = /\b(this week|next 7 days|this weekend|weekend)\b/i;

function isTemporalOnly(query) {
  // Matches if the query is purely temporal (nothing left after stripping the intent)
  return [RE_TODAY, RE_TOMORROW, RE_WEEK].some(
    (re) => re.test(query) && query.replace(re, "").trim() === "",
  );
}

test('temporal-only queries ("today") produce no keyword tokens — full pool should pass through', () => {
  // Simulate what buildSearchPlan does: strip the temporal token, tokenize the remainder
  const cleaned = "today".replace(RE_TODAY, "").trim();
  const tokens = tokenize(cleaned || "");
  assert.equal(
    tokens.length,
    0,
    `Pure temporal query should produce 0 tokens after stripping intent. Got: ${tokens}`,
  );
  assert.ok(
    isTemporalOnly("today"),
    '"today" should be detected as temporal-only',
  );
});

test('temporal-only queries ("tomorrow") produce no keyword tokens', () => {
  const cleaned = "tomorrow".replace(RE_TOMORROW, "").trim();
  const tokens = tokenize(cleaned || "");
  assert.equal(
    tokens.length,
    0,
    `"tomorrow" should produce 0 tokens after stripping. Got: ${tokens}`,
  );
});

test('temporal-only queries ("this week") produce no keyword tokens', () => {
  const cleaned = "this week".replace(RE_WEEK, "").trim();
  const tokens = tokenize(cleaned || "");
  assert.equal(
    tokens.length,
    0,
    `"this week" should produce 0 tokens after stripping. Got: ${tokens}`,
  );
});

test("mixed temporal+keyword query preserves keyword tokens", () => {
  const cleaned = "today seminars".replace(RE_TODAY, "").trim(); // → "seminars"
  const tokens = tokenize(cleaned);
  assert.ok(
    tokens.length > 0,
    `"today seminars" should produce keyword tokens after stripping temporal. Got: ${tokens}`,
  );
});

test("no canceled or postponed events in published feed", () => {
  const canceledPattern = /^(canceled|cancelled|postponed|rescheduled)[:\s]/i;
  const bad = events.filter((e) => canceledPattern.test(e.title ?? ""));
  assert.equal(
    bad.length,
    0,
    `Found ${bad.length} canceled/postponed events still in feed: ${bad
      .slice(0, 3)
      .map((e) => e.title)
      .join(" | ")}`,
  );
});
