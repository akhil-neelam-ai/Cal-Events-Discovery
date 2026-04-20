import assert from 'node:assert/strict';
import test from 'node:test';

import { getSnapshotTimestamp, isSearchIndexUsable } from '../../utils/snapshotValidation.ts';
import { buildUrlStateSearch, parseUrlState } from '../../utils/urlState.ts';

const DEFAULT_FILTERS = {
  dateRange: 'today',
  category: 'All',
  searchQuery: '',
  source: 'All',
};

const OPTIONS = {
  defaultFilters: DEFAULT_FILTERS,
  allowedCategories: ['All', 'Academic', 'Arts', 'Sports', 'Science & Tech', 'Student Life', 'Entrepreneurship'],
  allowedSources: ['All', 'livewhale', 'ehub', 'gemini', 'cal_performances', 'bampfa', 'calbears', 'callink', 'haas', 'berkeley_law', 'simons'],
};

test('parseUrlState restores shareable filters and selected event', () => {
  const parsed = parseUrlState('?q=ai%20talks&date=week&category=Science%20%26%20Tech&source=livewhale&event=evt-42', OPTIONS);

  assert.deepEqual(parsed.filters, {
    dateRange: 'week',
    category: 'Science & Tech',
    searchQuery: 'ai talks',
    source: 'livewhale',
  });
  assert.equal(parsed.selectedEventId, 'evt-42');
});

test('parseUrlState ignores unsupported values', () => {
  const parsed = parseUrlState('?date=month&category=Unknown&source=made-up&event=', OPTIONS);

  assert.deepEqual(parsed.filters, DEFAULT_FILTERS);
  assert.equal(parsed.selectedEventId, null);
});

test('buildUrlStateSearch omits defaults and trims search text', () => {
  const serialized = buildUrlStateSearch(
    {
      ...DEFAULT_FILTERS,
      searchQuery: '  career fair  ',
      dateRange: 'upcoming',
      source: 'callink',
    },
    'event-123',
    { defaultFilters: DEFAULT_FILTERS },
  );

  assert.equal(serialized, '?q=career+fair&date=upcoming&source=callink&event=event-123');
});

test('buildUrlStateSearch clears empty shareable state', () => {
  const serialized = buildUrlStateSearch(DEFAULT_FILTERS, null, { defaultFilters: DEFAULT_FILTERS });
  assert.equal(serialized, '');
});

test('isSearchIndexUsable accepts matching metadata', () => {
  const events = [{ id: 'evt-1' }, { id: 'evt-2' }];
  const index = {
    ids: ['evt-1', 'evt-2'],
    t: {},
    g: {},
    o: {},
    d: {},
    buildAt: '2026-04-19T21:26:56.393Z',
    eventCount: 2,
  };

  assert.equal(
    isSearchIndexUsable(index, events, Date.parse('2026-04-19T21:26:56.393Z')),
    true,
  );
});

test('isSearchIndexUsable rejects mismatched metadata', () => {
  const events = [{ id: 'evt-1' }, { id: 'evt-2' }];
  const index = {
    ids: ['evt-1', 'evt-2'],
    t: {},
    g: {},
    o: {},
    d: {},
    buildAt: '2026-04-18T21:26:56.393Z',
    eventCount: 3,
  };

  assert.equal(
    isSearchIndexUsable(index, events, Date.parse('2026-04-19T21:26:56.393Z')),
    false,
  );
});

test('getSnapshotTimestamp prefers snapshot metadata', () => {
  assert.equal(
    getSnapshotTimestamp(1_234),
    1_234,
  );
  assert.equal(
    getSnapshotTimestamp(undefined, undefined),
    null,
  );
});
