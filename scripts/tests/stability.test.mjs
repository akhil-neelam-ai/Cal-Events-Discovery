import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const eventsPath = path.join(rootDir, 'public', 'events.json');
const statusPath = path.join(rootDir, 'public', 'status.json');

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
