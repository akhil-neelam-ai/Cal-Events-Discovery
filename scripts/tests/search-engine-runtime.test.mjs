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
  {
    id: 'evt-bampfa',
    title: 'Dreams Are Colder Than Death',
    organizer: 'BAMPFA',
    date: '2026-04-22',
    time: '7:00 PM',
    location: 'BAMPFA, 2155 Center Street',
    description: 'A film screening at BAMPFA.',
    tags: ['Arts'],
    url: 'https://example.com/bampfa',
    source: 'bampfa',
  },
  {
    id: 'evt-free',
    title: 'Free Student Event on Northside',
    organizer: 'Student Union',
    date: '2026-04-22',
    time: '6:00 PM',
    location: 'Hearst Mining Circle, Northside Berkeley',
    description: 'A free student event with food near Euclid.',
    tags: ['Student Life'],
    url: 'https://example.com/free',
    source: 'callink',
  },
  {
    id: 'evt-founder',
    title: 'Founder Talk for Students',
    organizer: 'SkyDeck',
    date: '2026-04-23',
    time: '4:00 PM',
    location: 'Downtown Berkeley',
    description: 'A startup founder talk for Berkeley students.',
    tags: ['Entrepreneurship'],
    url: 'https://example.com/founder',
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

test('natural-language query "film screening at bampfa" finds the BAMPFA film first', () => {
  const output = searchEvents(SYNTHETIC_EVENTS, 'film screening at bampfa', null);

  assert.equal(output.plan.filters.category, 'Arts');
  assert.equal(output.results[0]?.id, 'evt-bampfa');
});

test('natural-language query "free events near northside" applies free and campus-area filters', () => {
  const output = searchEvents(SYNTHETIC_EVENTS, 'free events near northside', null);

  assert.equal(output.plan.filters.free, true);
  assert.equal(output.plan.filters.campusArea, 'northside');
  assert.deepEqual(output.results.map(event => event.id), ['evt-free']);
});

test('natural-language query "founder talks tomorrow" preserves tomorrow intent and ranks entrepreneurship events', () => {
  const output = searchEvents(SYNTHETIC_EVENTS, 'founder talks tomorrow', null);

  assert.equal(output.plan.filters.dateRange, 'tomorrow');
  assert.equal(output.plan.filters.category, 'Entrepreneurship');
  assert.equal(output.results[0]?.id, 'evt-founder');
});
