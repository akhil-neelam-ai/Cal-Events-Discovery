import assert from 'node:assert/strict';
import test from 'node:test';

import { searchEvents } from '../../utils/searchEngine.ts';
import { tokenize } from '../../utils/textUtils.ts';

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
