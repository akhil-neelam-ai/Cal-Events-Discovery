import type { IngestionStatus } from '../types';
import type { SearchIndex } from './textUtils';

const SEARCH_INDEX_BUILD_TOLERANCE_MS = 60_000;

interface EventIdentity {
  id: string;
}

export function getSnapshotTimestamp(lastUpdated?: number, generatedAt?: string): number | null {
  if (typeof lastUpdated === 'number' && Number.isFinite(lastUpdated) && lastUpdated > 0) {
    return lastUpdated;
  }

  if (generatedAt) {
    const parsed = Date.parse(generatedAt);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

export function resolvePublishedLastUpdated(
  lastUpdated?: number,
  status?: Pick<IngestionStatus, 'generated_at'>,
): number {
  return getSnapshotTimestamp(lastUpdated, status?.generated_at) ?? 0;
}

export function getSearchIndexValidationError(
  index: SearchIndex | null,
  events: EventIdentity[],
  lastUpdated?: number | null,
): string | null {
  if (!index) {
    return 'missing search index';
  }

  if (!Array.isArray(index.ids)) {
    return 'index ids missing';
  }

  if (index.eventCount !== events.length) {
    return `eventCount mismatch (${index.eventCount} !== ${events.length})`;
  }

  if (index.ids.length !== events.length) {
    return `ids length mismatch (${index.ids.length} !== ${events.length})`;
  }

  for (let position = 0; position < events.length; position += 1) {
    if (index.ids[position] !== events[position]?.id) {
      return `id mismatch at position ${position}`;
    }
  }

  const buildAtMs = Date.parse(index.buildAt);
  if (!Number.isFinite(buildAtMs)) {
    return 'buildAt missing or invalid';
  }

  if (
    typeof lastUpdated === 'number' &&
    Number.isFinite(lastUpdated) &&
    lastUpdated > 0 &&
    buildAtMs + SEARCH_INDEX_BUILD_TOLERANCE_MS < lastUpdated
  ) {
    return `buildAt older than events snapshot (${index.buildAt})`;
  }

  return null;
}

export function isSearchIndexCompatible(
  index: SearchIndex | null,
  events: EventIdentity[],
  lastUpdated?: number | null,
): boolean {
  return getSearchIndexValidationError(index, events, lastUpdated) === null;
}

export function isSearchIndexUsable(
  index: SearchIndex | null,
  events: EventIdentity[],
  lastUpdated?: number | null,
): boolean {
  return isSearchIndexCompatible(index, events, lastUpdated);
}
