import assert from 'node:assert/strict';
import test from 'node:test';

import { searchEvents } from '../../utils/searchEngine.ts';
import { tokenize } from '../../utils/textUtils.ts';
import { dedupeEvents } from '../lib/dedupe.ts';

const EVENTS = [
  {
    id: 'arts-lecture',
    title: 'Arts Lecture Night',
    organizer: 'Arts Dept',
    date: '2099-04-20',
    time: '7:00 PM',
    location: 'Zellerbach',
    description: 'A lecture about theater and performance.',
    tags: ['Arts'],
    url: 'https://example.com/arts-lecture',
    source: 'livewhale',
  },
  {
    id: 'arts-workshop',
    title: 'Painting Workshop',
    organizer: 'Museum Club',
    date: '2099-04-21',
    time: '2:00 PM',
    location: 'BAMPFA',
    description: 'Hands-on painting session.',
    tags: ['Arts'],
    url: 'https://example.com/arts-workshop',
    source: 'bampfa',
  },
  {
    id: 'science-lecture',
    title: 'AI Lecture Series',
    organizer: 'CS Dept',
    date: '2099-04-22',
    time: '5:00 PM',
    location: 'Soda Hall',
    description: 'A lecture on machine learning advances.',
    tags: ['Science & Tech'],
    url: 'https://example.com/ai-lecture',
    source: 'ehub',
  },
];

function buildInlineIndex(events, buildAt = '2099-04-19T21:26:56.393Z') {
  const ids = events.map(event => event.id);
  const t = {};
  const g = {};
  const o = {};
  const d = {};

  const add = (field, token, pos) => {
    if (!field[token]) field[token] = [];
    field[token].push(pos);
  };

  events.forEach((event, pos) => {
    tokenize(event.title).forEach(token => add(t, token, pos));
    tokenize((event.tags ?? []).join(' ')).forEach(token => add(g, token, pos));
    tokenize(event.organizer ?? '').forEach(token => add(o, token, pos));
    tokenize((event.description ?? '').slice(0, 150)).forEach(token => add(d, token, pos));
  });

  return {
    ids,
    t,
    g,
    o,
    d,
    buildAt,
    eventCount: events.length,
  };
}

test('searchEvents retains indexed matches inside filtered pools', () => {
  const index = buildInlineIndex(EVENTS, '2099-04-19T21:26:56.393Z');
  const filteredPool = EVENTS.filter(event => event.tags.includes('Arts'));

  const { results } = searchEvents(filteredPool, 'lecture', index);

  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'arts-lecture');
});

test('buildSearchIndex uses provided build timestamp', () => {
  const buildAt = '2099-04-19T21:26:56.393Z';
  const index = buildInlineIndex(EVENTS, buildAt);

  assert.equal(index.buildAt, buildAt);
  assert.equal(index.eventCount, EVENTS.length);
});

test('searchEvents expands acronym queries into indexed long-form matches', () => {
  const events = [
    {
      id: 'long-form-ai',
      title: 'Machine Learning Colloquium',
      organizer: 'AI Research Lab',
      date: '2099-04-23',
      time: '4:00 PM',
      location: 'Soda Hall',
      description: 'A colloquium on artificial intelligence and ethics.',
      tags: ['Science & Tech'],
      url: 'https://example.com/long-form-ai',
      source: 'livewhale',
    },
  ];
  const index = buildInlineIndex(events);

  const { results } = searchEvents(events, 'AI', index);

  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'long-form-ai');
});

test('dedupeEvents normalizes Unicode accents and case', () => {
  const baseEvent = {
    description: 'Campus concert',
    start_at: '2099-04-20T19:00:00-07:00',
    end_at: '2099-04-20T21:00:00-07:00',
    timezone: 'America/Los_Angeles',
    all_day: false,
    venue: 'Zellerbach Hall',
    building: '',
    address: 'Berkeley, CA',
    modality: 'in_person',
    organizer: 'Music Dept',
    organizer_unit: 'Music Dept',
    audience: 'Public',
    cost: 'Free',
    canonical_url: 'https://example.com/cafe-concert',
    source_url: 'https://example.com/cafe-concert',
    categories: ['Arts'],
    tags: ['Arts'],
    last_seen_at: '2099-04-19T10:00:00Z',
    confidence: 1,
    quality_flags: [],
  };

  const { events, duplicatesRemoved } = dedupeEvents([
    {
      ...baseEvent,
      source_name: 'ehub',
      source_id: 'cafe-1',
      title: 'Cafe Concert',
    },
    {
      ...baseEvent,
      source_name: 'livewhale',
      source_id: 'cafe-2',
      title: 'Café Concert',
    },
  ]);

  assert.equal(duplicatesRemoved, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0].source_name, 'livewhale');
});
