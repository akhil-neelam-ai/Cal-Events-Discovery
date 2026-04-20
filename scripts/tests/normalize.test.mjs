import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeForDedupe } from '../lib/normalize.js';

test('normalizeForDedupe removes accent and case differences', () => {
  assert.equal(normalizeForDedupe('Café Concert'), normalizeForDedupe('Cafe Concert'));
  assert.equal(normalizeForDedupe('STEM Showcase'), normalizeForDedupe('stem showcase'));
});
