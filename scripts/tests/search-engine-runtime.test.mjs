import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSearchPlan, searchEvents } from '../../utils/searchEngine.ts';

const SYNTHETIC_EVENTS = [
  {
    id: 'evt-north',
    title: 'Northside Quantum Talk',
    organizer: 'EECS',
    date: '2026-04-22',
    time: '5:00 PM',
    location: 'Sutardja Dai Hall, Northside Berkeley',
    description: 'An evening talk near Hearst and Euclid.',
    tags: ['Science & Tech'],
    url: 'https://example.com/north',
    source: 'livewhale',
  },
  {
    id: 'evt-south',
    title: 'Southside Robotics Talk',
    organizer: 'Engineering',
    date: '2026-04-22',
    time: '5:00 PM',
    location: 'Telegraph Avenue, Southside Berkeley',
    description: 'A robotics talk on south campus.',
    tags: ['Science & Tech'],
    url: 'https://example.com/south',
    source: 'livewhale',
  },
  {
    id: 'evt-downtown',
    title: 'Downtown Founder Meetup',
    organizer: 'SkyDeck',
    date: '2026-04-24',
    time: '6:00 PM',
    location: 'Shattuck Avenue, Downtown Berkeley',
    description: 'A startup meetup near BART.',
    tags: ['Entrepreneurship'],
    url: 'https://example.com/downtown',
    source: 'ehub',
  },
];

test('structured-only temporal queries do not turn into text keywords', () => {
  const todayPlan = buildSearchPlan('today');
  const tomorrowPlan = buildSearchPlan('tomorrow');

  assert.equal(todayPlan.filters.dateRange, 'today');
  assert.equal(tomorrowPlan.filters.dateRange, 'tomorrow');
  assert.deepEqual(todayPlan.keywords, []);
  assert.deepEqual(tomorrowPlan.keywords, []);
});

test('pure temporal queries return the full pool for later date filtering', () => {
  const todayResults = searchEvents(SYNTHETIC_EVENTS, 'today', null);
  const tomorrowResults = searchEvents(SYNTHETIC_EVENTS, 'tomorrow', null);

  assert.equal(todayResults.results.length, SYNTHETIC_EVENTS.length);
  assert.equal(tomorrowResults.results.length, SYNTHETIC_EVENTS.length);
});

test('campus area acts as a real hard filter when interpreted', () => {
  const output = searchEvents(SYNTHETIC_EVENTS, 'northside talk', null);

  assert.equal(output.plan.filters.campusArea, 'northside');
  assert.deepEqual(
    output.results.map(event => event.id),
    ['evt-north'],
  );
});

test('dismissing campus area removes the hard filter', () => {
  const output = searchEvents(SYNTHETIC_EVENTS, 'northside talk', null, new Set(['campusArea:northside']));

  assert.equal(output.plan.filters.campusArea, undefined);
  assert.ok(output.results.some(event => event.id === 'evt-south'));
});
