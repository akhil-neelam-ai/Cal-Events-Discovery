/**
 * Collapse multi-day / recurring events into a single event.
 *
 * Some sources (notably LiveWhale) publish a long-running event — a months-long
 * exhibit, a weekly program — as one VEVENT per day, each with a distinct UID.
 * Left alone, a single exhibit becomes 100+ rows that flood the feed. This step
 * groups those rows back into one event spanning start_at → end_at, recording
 * every upcoming occurrence in `occurrence_dates` so the frontend can tell a
 * continuous run apart from a gappy series.
 *
 * Grouping key:
 *   - LiveWhale UIDs look like "<YYYYMMDD>T<HHMMSS>Z-<eventNo>@events.berkeley.edu".
 *     The "<eventNo>@..." suffix is the stable identity; the datestamp prefix is
 *     just the per-day discriminator. We strip the prefix to group days together.
 *   - BAMPFA and Simons embed a per-occurrence date (::YYYY-MM-DD) in their IDs;
 *     BAMPFA also appends a month slug (-month-YYYY). Both are stripped to form
 *     the stable key so recurring program rows collapse into one event.
 *   - All other sources use a unique source_id per logical event, so groups are
 *     size 1 and pass through untouched.
 */

import type { CanonicalEvent } from "./schema.js";
import { isoDateInPT } from "./normalize.js";

const LIVEWHALE_DATESTAMP_PREFIX = /^\d{8}T\d{6}Z-/;
// Trailing per-occurrence date appended to source_id by BAMPFA and Simons,
// e.g. "open-art-lab-june-2026::2026-06-04" or "events-tea-time-talks::2026-06-05".
const TRAILING_OCCURRENCE_DATE = /::\d{4}-\d{2}-\d{2}$/;
// Month-specific slug suffix BAMPFA uses for recurring programs, e.g.
// "open-art-lab-june-2026" → "open-art-lab" so all months of the same program group.
const TRAILING_MONTH_SLUG =
  /-(january|february|march|april|may|june|july|august|september|october|november|december)-\d{4}$/i;

// Per-source strip rules. Add a source here to opt it into collapse.
// BAMPFA: strips occurrence date + month slug.
// Simons: strips occurrence date only (slugs are URL-path-derived, no month suffix).
const ID_STRIP_RULES: Partial<Record<string, RegExp[]>> = {
  bampfa: [TRAILING_OCCURRENCE_DATE, TRAILING_MONTH_SLUG],
  simons: [TRAILING_OCCURRENCE_DATE],
};

/** Stable per-event identity used to group per-day rows of the same event. */
export function stableEventKey(event: CanonicalEvent): string {
  if (event.source_name === "livewhale") {
    const stable = event.source_id.replace(LIVEWHALE_DATESTAMP_PREFIX, "");
    return `livewhale::${stable}`;
  }
  const rules = ID_STRIP_RULES[event.source_name] ?? [];
  const stable = rules.reduce((id, re) => id.replace(re, ""), event.source_id);
  return `${event.source_name}::${stable}`;
}

export interface CollapseResult {
  events: CanonicalEvent[];
  /** Number of redundant per-day rows removed. */
  rowsEliminated: number;
  /** Number of events that were multi-day (collapsed from >1 row). */
  multiDayEvents: number;
}

/**
 * Merge per-day rows sharing a stable identity into single multi-day events.
 * Single-day events are returned unchanged. Order is not guaranteed; the
 * orchestrator sorts afterward.
 */
export function collapseMultiDay(events: CanonicalEvent[]): CollapseResult {
  const groups = new Map<string, CanonicalEvent[]>();
  for (const event of events) {
    const key = stableEventKey(event);
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(event);
    } else {
      groups.set(key, [event]);
    }
  }

  const out: CanonicalEvent[] = [];
  let rowsEliminated = 0;
  let multiDayEvents = 0;

  for (const bucket of groups.values()) {
    // Sort by the event's PT occurrence date so the earliest is representative.
    bucket.sort((a, b) =>
      isoDateInPT(a.start_at).localeCompare(isoDateInPT(b.start_at)),
    );

    const distinctDates = [
      ...new Set(bucket.map((e) => isoDateInPT(e.start_at)).filter(Boolean)),
    ].sort();

    if (distinctDates.length <= 1) {
      // Genuinely single-day (one row, or duplicate rows on the same date).
      out.push(bucket[0]);
      rowsEliminated += bucket.length - 1;
      continue;
    }

    const earliest = bucket[0];
    const latest = bucket[bucket.length - 1];
    const stableId = stableEventKey(earliest).split("::").slice(1).join("::");

    out.push({
      ...earliest,
      source_id: stableId,
      // start_at keeps the earliest upcoming occurrence; end_at spans to the
      // last day the event occurs (its PT date).
      start_at: earliest.start_at,
      end_at: isoDateInPT(latest.start_at),
      occurrence_dates: distinctDates,
    });
    rowsEliminated += bucket.length - 1;
    multiDayEvents += 1;
  }

  return { events: out, rowsEliminated, multiDayEvents };
}
