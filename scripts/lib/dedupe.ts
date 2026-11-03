/**
 * Cross-source dedupe.
 *
 * Strategy: bucket by (normalized_title, date). Within a bucket, keep the
 * highest-priority source, and all of its rows whose start times differ.
 * Source priority reflects data quality:
 *   livewhale (structured iCal) > callink/cal_performances/calbears (JSON APIs)
 */

import type { CanonicalEvent, LegacyCalEvent, SourceName } from "./schema.js";
import {
  firstOccurrencePT,
  normalizeForDedupe,
  sanitizePlainText,
} from "./normalize.js";

const SOURCE_PRIORITY: Record<SourceName, number> = {
  livewhale: 4,
  callink: 3,
  cal_performances: 3,
  calbears: 3,
  bampfa: 3,
  // Haas and Berkeley Law run The Events Calendar (Tribe) on WordPress —
  // structured JSON is higher-quality than HTML scraping, on par with the
  // other JSON-API sources. Below livewhale because the central feed is a
  // superset for any events that happen to be cross-published.
  haas: 3,
  berkeley_law: 3,
  simons: 3,
  luma: 3,
  begin: 3,
  ai_risk: 3,
  brsl: 3,
  cltc: 3,
};

export interface DedupeResult {
  events: CanonicalEvent[];
  duplicatesRemoved: number;
}

function dedupeKey(event: CanonicalEvent): string {
  // A span that started before today is keyed on today, the day it is
  // published under, so it still meets another source's copy.
  const date = firstOccurrencePT(event);
  const normalizedTitle = normalizeForDedupe(event.title);
  const identity = normalizedTitle
    ? ["title", normalizedTitle]
    : ["source", event.source_name, event.source_id];

  return JSON.stringify([...identity, date]);
}

/**
 * Same-priority tie-break: pick a stable winner that does not depend on which
 * candidate arrived first in upstream API order. Otherwise the published event
 * id (`${source_name}_${source_id}`) can silently flip whenever an upstream
 * re-sorts its response, breaking yesterday's `?event=<id>` deep links.
 *
 * Order: alphabetical `source_name`, then alphabetical `source_id`.
 */
function tieBreak(a: CanonicalEvent, b: CanonicalEvent): CanonicalEvent {
  const sourceCmp = a.source_name.localeCompare(b.source_name);
  if (sourceCmp !== 0) return sourceCmp < 0 ? a : b;
  const idCmp = a.source_id.localeCompare(b.source_id);
  return idCmp <= 0 ? a : b;
}

/** True when `a`'s source should hold a shared key instead of `b`'s. */
function outranks(a: CanonicalEvent, b: CanonicalEvent): boolean {
  const ap = SOURCE_PRIORITY[a.source_name];
  const bp = SOURCE_PRIORITY[b.source_name];
  if (ap !== bp) return ap > bp;
  return a.source_name.localeCompare(b.source_name) < 0;
}

function startInstant(event: CanonicalEvent): number {
  const parsed = Date.parse(event.start_at);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** `target` with `copy`'s source and page added to its other listings. */
function withListing(
  target: CanonicalEvent,
  copy: CanonicalEvent,
): CanonicalEvent {
  const listings = [...(target.also_listed ?? [])];
  const incoming = [
    { source: copy.source_name, url: copy.canonical_url || copy.source_url },
    ...(copy.also_listed ?? []),
  ];
  for (const listing of incoming) {
    if (
      listing.source !== target.source_name &&
      !listings.some((held) => held.source === listing.source)
    ) {
      listings.push(listing);
    }
  }
  return { ...target, also_listed: listings };
}

function venueKey(event: CanonicalEvent): string {
  const venue =
    [event.venue, event.building].filter(Boolean).join(" ") || event.address;
  return sanitizePlainText(venue)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function titleWords(title: string): Set<string> {
  return new Set(normalizeForDedupe(title).split(" ").filter(Boolean));
}

/** True when every word of the shorter title, two or more, is in the other. */
function titlesMatch(a: string, b: string): boolean {
  const x = titleWords(a);
  const y = titleWords(b);
  const [shorter, longer] = x.size <= y.size ? [x, y] : [y, x];
  return shorter.size >= 2 && [...shorter].every((word) => longer.has(word));
}

/**
 * Two sources can title one event differently, as with "California Women's
 * Basketball vs Washington State" and "... Washington State University".
 * Copies from different sources merge when they start at the same instant,
 * at the same venue (one name may contain the other), and one title's words
 * all appear in the other's.
 */
function mergeNearDuplicates(events: CanonicalEvent[]): CanonicalEvent[] {
  const byStart = new Map<number, number[]>();
  events.forEach((event, index) => {
    const at = startInstant(event);
    byStart.set(at, [...(byStart.get(at) ?? []), index]);
  });

  const result = [...events];
  const dropped = new Set<number>();
  for (const indexes of byStart.values()) {
    for (let a = 0; a < indexes.length; a++) {
      for (let b = a + 1; b < indexes.length; b++) {
        const [i, j] = [indexes[a], indexes[b]];
        if (dropped.has(i) || dropped.has(j)) continue;
        const [x, y] = [result[i], result[j]];
        const [xVenue, yVenue] = [venueKey(x), venueKey(y)];
        if (
          x.source_name === y.source_name ||
          !xVenue ||
          !yVenue ||
          !(xVenue.includes(yVenue) || yVenue.includes(xVenue)) ||
          !titlesMatch(x.title, y.title)
        ) {
          continue;
        }
        const [keep, drop] = outranks(x, y) ? [i, j] : [j, i];
        result[keep] = withListing(result[keep], result[drop]);
        dropped.add(drop);
      }
    }
  }
  return result.filter((_, index) => !dropped.has(index));
}

export function dedupeEvents(events: CanonicalEvent[]): DedupeResult {
  // Each key keeps only the winning source's rows. One source can list a
  // title twice on one day, like a doubleheader or a second tour session,
  // so its own rows merge only when their start times also match.
  const buckets = new Map<string, CanonicalEvent[]>();
  // Other sources' copies dropped from each key, so the kept row can list them.
  const mergedCopies = new Map<string, CanonicalEvent[]>();

  for (const event of events) {
    const key = dedupeKey(event);
    const rows = buckets.get(key);
    if (!rows) {
      buckets.set(key, [event]);
      continue;
    }
    if (rows[0].source_name !== event.source_name) {
      const copies = mergedCopies.get(key) ?? [];
      if (outranks(event, rows[0])) {
        copies.push(...rows);
        buckets.set(key, [event]);
      } else {
        copies.push(event);
      }
      mergedCopies.set(key, copies);
      continue;
    }
    const sameStart = rows.findIndex(
      (row) => startInstant(row) === startInstant(event),
    );
    if (sameStart === -1) {
      rows.push(event);
    } else {
      rows[sameStart] = tieBreak(event, rows[sameStart]);
    }
  }

  // A merged copy goes to the kept row with its start time, else the first.
  for (const [key, copies] of mergedCopies) {
    const rows = buckets.get(key) ?? [];
    for (const copy of copies) {
      const index = Math.max(
        0,
        rows.findIndex((row) => startInstant(row) === startInstant(copy)),
      );
      rows[index] = withListing(rows[index], copy);
    }
  }

  const deduped = mergeNearDuplicates([...buckets.values()].flat());
  return {
    events: deduped,
    duplicatesRemoved: events.length - deduped.length,
  };
}

function publishedDedupeKey(event: LegacyCalEvent, today: string): string {
  // A restored multi-day row keeps yesterday's `date`, so key on its first
  // day from today on, the day a fresh copy would be published under.
  const [first] = (event.dates ?? [event.date])
    .filter((day) => day >= today)
    .sort();
  const normalizedTitle = normalizeForDedupe(event.title);
  const identity = normalizedTitle
    ? ["title", normalizedTitle]
    : ["id", event.id];
  return JSON.stringify([...identity, first ?? event.date]);
}

function pickPublished(a: LegacyCalEvent, b: LegacyCalEvent): LegacyCalEvent {
  const ap = SOURCE_PRIORITY[a.source as SourceName] ?? 0;
  const bp = SOURCE_PRIORITY[b.source as SourceName] ?? 0;
  if (ap !== bp) return ap > bp ? a : b;
  const sourceCmp = a.source.localeCompare(b.source);
  if (sourceCmp !== 0) return sourceCmp < 0 ? a : b;
  return a.id.localeCompare(b.id) <= 0 ? a : b;
}

/**
 * Last-good restores skip `dedupeEvents`, so a restored copy can meet a
 * lower-priority copy of the same event published today. This runs the same
 * title-and-date key over published rows, only for groups that hold a
 * restored row, and keeps the higher-priority copy. A restored LiveWhale row
 * beats a fresh Haas row, which keeps yesterday's `?event=` links working.
 */
export function dedupeRestoredEvents(
  events: LegacyCalEvent[],
  restoredIds: ReadonlySet<string>,
  today: string,
): LegacyCalEvent[] {
  if (restoredIds.size === 0) return events;

  const buckets = new Map<string, LegacyCalEvent[]>();
  for (const event of events) {
    const key = publishedDedupeKey(event, today);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(event);
    } else {
      buckets.set(key, [event]);
    }
  }

  const dropped = new Set<LegacyCalEvent>();
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;
    if (!bucket.some((event) => restoredIds.has(event.id))) continue;
    // As in dedupeEvents, the winning source keeps each row with its own
    // time, such as both games of a doubleheader.
    const winner = bucket.reduce(pickPublished);
    const keptByTime = new Map<string, LegacyCalEvent>();
    for (const event of bucket) {
      if (event.source !== winner.source) {
        dropped.add(event);
        continue;
      }
      const held = keptByTime.get(event.time);
      if (!held) {
        keptByTime.set(event.time, event);
        continue;
      }
      const keep = pickPublished(held, event);
      dropped.add(keep === held ? event : held);
      keptByTime.set(event.time, keep);
    }
  }

  return dropped.size === 0
    ? events
    : events.filter((event) => !dropped.has(event));
}
