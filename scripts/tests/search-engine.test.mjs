import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSearchIndex } from '../lib/buildIndex.ts';
import { searchEvents } from '../../utils/searchEngine.ts';

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

test('searchEvents retains indexed matches inside filtered pools', () => {
  const index = buildSearchIndex(EVENTS, '2099-04-19T21:26:56.393Z');
  const filteredPool = EVENTS.filter(event => event.tags.includes('Arts'));

  const { results } = searchEvents(filteredPool, 'lecture', index);

  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'arts-lecture');
});

test('buildSearchIndex uses provided build timestamp', () => {
  const buildAt = '2099-04-19T21:26:56.393Z';
  const index = buildSearchIndex(EVENTS, buildAt);

  assert.equal(index.buildAt, buildAt);
  assert.equal(index.eventCount, EVENTS.length);
});
