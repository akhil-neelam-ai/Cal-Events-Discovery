/**
 * Last-good fallback helpers for the publish pipeline.
 *
 * When a source is degraded and `allowLastGood: true`, the orchestrator
 * restores yesterday's events for that source from the previously-published
 * events.json. Two invariants the filter must hold:
 *
 *  1. Don't drop multi-day exhibits whose earliest day is already past but
 *     whose `end_date` / `dates[]` are still in the future. A "earliest-date
 *     only" filter silently loses months-long BAMPFA exhibits and semester
 *     lecture series — exactly the events the fallback is supposed to keep
 *     visible.
 *
 *  2. Don't re-publish events the live source has already marked canceled.
 *     If the same regex that strips "Canceled: <title>" from the freshly-
 *     deduped set is not applied to the last-good restore, a cancellation on
 *     day N+1 is silently undone whenever the source flakes on day N+2.
 */

import type { LegacyCalEvent, SourceName } from "./schema.js";

/**
 * Titles that begin with any of these markers are dropped on both the live
 * dedupe path and the last-good restore path. Sources upstream of us (Tribe,
 * LiveWhale, CallLink) signal cancellation/postponement by prefixing the
 * title rather than removing the event; we treat both as "not happening".
 */
export const CANCELED_TITLE_PATTERN =
  /^(canceled|cancelled|postponed|rescheduled)[:\s]/i;

export function isValidDateKey(dateKey: string): boolean {
  const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

/**
 * True when a published event still has at least one in-progress or future
 * occurrence on the PT calendar. Single-day events expose only `date`;
 * multi-day events also expose `end_date` (last occurrence) and `dates[]`
 * (every upcoming occurrence day).
 */
export function hasFutureOccurrence(
  event: Pick<LegacyCalEvent, "date" | "end_date" | "dates">,
  today: string,
): boolean {
  if (isValidDateKey(event.date) && event.date >= today) return true;
  if (
    event.end_date &&
    isValidDateKey(event.end_date) &&
    event.end_date >= today
  ) {
    return true;
  }
  if (event.dates) {
    for (const d of event.dates) {
      if (isValidDateKey(d) && d >= today) return true;
    }
  }
  return false;
}

/**
 * Pull last-good events for `source` from the previously-published events
 * list. Filters out events whose every occurrence is past, and events whose
 * title was prefixed with a cancel marker upstream.
 */
export function loadLastGoodForSource(
  existing: LegacyCalEvent[],
  source: SourceName,
  today: string,
): LegacyCalEvent[] {
  return existing.filter(
    (e) =>
      e.source === source &&
      hasFutureOccurrence(e, today) &&
      !CANCELED_TITLE_PATTERN.test(e.title),
  );
}

/**
 * Append last-good events for `source` into `legacy`, deduping by id against
 * what's already present. Returns the number of events restored. Caller is
 * responsible for the final sort across the merged set (the orchestrator
 * already does `legacy.sort(compareLegacyEvents)` after running this for
 * every degraded source).
 */
export function appendLastGoodEvents(
  legacy: LegacyCalEvent[],
  existing: LegacyCalEvent[],
  source: SourceName,
  today: string,
): number {
  const lastGood = loadLastGoodForSource(existing, source, today);
  if (lastGood.length === 0) return 0;
  const seenIds = new Set(legacy.map((e) => e.id));
  const merged = lastGood.filter((e) => !seenIds.has(e.id));
  if (merged.length === 0) return 0;
  legacy.push(...merged);
  return merged.length;
}
