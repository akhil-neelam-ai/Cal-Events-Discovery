import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getSnapshotTimestamp,
  isSearchIndexUsable,
} from '../../utils/snapshotValidation.ts';

test('getSnapshotTimestamp prefers snapshot timestamp when present', () => {
  const snapshotTimestamp = 1_700_000_000_000;
  assert.equal(getSnapshotTimestamp(snapshotTimestamp), snapshotTimestamp);
});

test('getSnapshotTimestamp falls back to status timestamp when snapshot timestamp is absent', () => {
  const statusTimestamp = '2026-04-19T21:26:56.393Z';
  assert.equal(getSnapshotTimestamp(undefined, statusTimestamp), Date.parse(statusTimestamp));
});

test('getSnapshotTimestamp returns null when no trustworthy timestamp exists', () => {
  assert.equal(getSnapshotTimestamp(), null);
  assert.equal(getSnapshotTimestamp(undefined, 'not-a-date'), null);
});

test('isSearchIndexUsable validates matching event counts and timestamps', () => {
  const events = [{ id: 'a' }, { id: 'b' }];
  assert.equal(
    isSearchIndexUsable(
      {
        ids: ['a', 'b'],
        t: {},
        g: {},
        o: {},
        d: {},
        buildAt: '2026-04-19T21:26:56.393Z',
        eventCount: 2,
      },
      events,
      Date.parse('2026-04-19T21:26:56.393Z'),
    ),
    true,
  );
});

test('isSearchIndexUsable rejects mismatched counts and stale timestamps', () => {
  const events = [{ id: 'a' }, { id: 'b' }];
  assert.equal(
    isSearchIndexUsable(
      {
        ids: ['a', 'b'],
        t: {},
        g: {},
        o: {},
        d: {},
        buildAt: '2026-04-19T21:26:56.393Z',
        eventCount: 2,
      },
      [...events, { id: 'c' }],
      Date.parse('2026-04-19T21:26:56.393Z'),
    ),
    false,
  );

  assert.equal(
    isSearchIndexUsable(
      {
        ids: ['a', 'b'],
        t: {},
        g: {},
        o: {},
        d: {},
        buildAt: '2026-04-19T20:00:00.000Z',
        eventCount: 2,
      },
      events,
      Date.parse('2026-04-19T21:26:56.393Z'),
    ),
    false,
  );
});
