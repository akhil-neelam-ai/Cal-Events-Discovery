import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const eventsPath = path.join(rootDir, 'public', 'events.json');
const statusPath = path.join(rootDir, 'public', 'status.json');
const searchIndexPath = path.join(rootDir, 'public', 'search-index.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isValidIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isUpcoming(date, today) {
  return date >= today;
}

const published = readJson(eventsPath);
const status = readJson(statusPath);
const searchIndex = readJson(searchIndexPath);

test('upcoming filtering uses date strings, not UTC parsing', () => {
  const today = '2026-04-18';
  const dates = ['2026-04-17', '2026-04-18', '2026-04-19'];

  assert.deepEqual(dates.filter(date => isUpcoming(date, today)), ['2026-04-18', '2026-04-19']);
  assert.equal(isUpcoming('2026-04-18', today), true);
  assert.equal(isUpcoming('2026-04-17', today), false);
});

test('published events artifact is internally consistent', () => {
  assert.ok(Array.isArray(published.events), 'events must be an array');
  assert.ok(published.events.length > 0, 'events must not be empty');
  assert.ok(Array.isArray(published.sources), 'sources must be an array');
  assert.ok(typeof published.lastUpdated === 'number', 'lastUpdated must be numeric');

  const ids = new Set();
  for (let index = 0; index < published.events.length; index += 1) {
    const event = published.events[index];
    assert.ok(event && typeof event === 'object', `event ${index} must be an object`);
    assert.equal(typeof event.id, 'string');
    assert.equal(typeof event.title, 'string');
    assert.equal(typeof event.organizer, 'string');
    assert.equal(typeof event.date, 'string');
    assert.equal(typeof event.time, 'string');
    assert.equal(typeof event.location, 'string');
    assert.equal(typeof event.description, 'string');
    assert.equal(typeof event.url, 'string');
    assert.ok(Array.isArray(event.tags), 'tags must be an array');
    assert.ok(isValidIsoDate(event.date), `event ${event.id} has invalid date ${event.date}`);
    assert.ok(!ids.has(event.id), `duplicate event id: ${event.id}`);
    ids.add(event.id);
  }
});

test('status report matches the published artifact', () => {
  assert.equal(status.total_events, published.events.length);
  assert.ok(Number.isInteger(status.duplicates_removed) && status.duplicates_removed >= 0);
  assert.ok(Number.isInteger(status.past_events_filtered) && status.past_events_filtered >= 0);
  assert.ok(Number.isInteger(status.invalid_events_filtered) && status.invalid_events_filtered >= 0);
  assert.ok(Array.isArray(status.sources), 'sources must be an array');
  assert.ok(status.sources.length > 0, 'status must include source entries');
  assert.equal(typeof status.generated_at, 'string');
  assert.equal(typeof status.fallback_used, 'boolean');
  assert.equal(typeof status.degraded, 'boolean');

  if (status.degraded) {
    assert.equal(typeof status.degraded_reason, 'string');
  }

  for (const source of status.sources) {
    assert.ok(source && typeof source === 'object', 'source entries must be objects');
    assert.equal(typeof source.name, 'string');
    assert.equal(typeof source.ok, 'boolean');
    assert.ok(Number.isInteger(source.count) && source.count >= 0);
    assert.ok(Number.isInteger(source.duration_ms) && source.duration_ms >= 0);
    assert.equal(typeof source.fetched_at, 'string');
  }
});

test('search index aligns with published events', () => {
  assert.ok(Array.isArray(searchIndex.ids), 'search index ids must be an array');
  assert.equal(searchIndex.eventCount, published.events.length, 'eventCount should match published events');
  assert.equal(searchIndex.ids.length, published.events.length, 'ids length should match published events');
  assert.ok(typeof searchIndex.buildAt === 'string', 'buildAt should be present');
  const buildAtMs = Date.parse(searchIndex.buildAt);
  const snapshotMs = published.lastUpdated;
  const statusMs = Date.parse(status.generated_at);
  assert.ok(Number.isFinite(buildAtMs), 'buildAt should parse as a timestamp');
  assert.ok(
    Math.abs(buildAtMs - snapshotMs) < 60_000 || Math.abs(buildAtMs - statusMs) < 60_000,
    'buildAt should track the published snapshot time',
  );

  const publishedIds = published.events.map(event => event.id);
  assert.deepEqual(searchIndex.ids, publishedIds, 'search index ids should preserve published event ordering');

  for (const field of ['t', 'g', 'o', 'd']) {
    assert.ok(searchIndex[field] && typeof searchIndex[field] === 'object', `${field} index must be an object`);

    for (const [token, positions] of Object.entries(searchIndex[field])) {
      assert.ok(Array.isArray(positions), `${field}.${token} must be an array`);
      let previous = -1;

      for (const position of positions) {
        assert.ok(Number.isInteger(position), `${field}.${token} positions must be integers`);
        assert.ok(position >= 0 && position < searchIndex.ids.length, `${field}.${token} position out of range`);
        assert.ok(position > previous, `${field}.${token} positions must be sorted and unique`);
        previous = position;
      }
    }
  }
});
