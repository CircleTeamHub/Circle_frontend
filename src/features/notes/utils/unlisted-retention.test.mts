import test from 'node:test';
import assert from 'node:assert/strict';
import { unlistedDaysLeft } from './unlisted-retention.ts';

const DAY = 24 * 60 * 60 * 1000;
const start = Date.parse('2026-11-13T00:00:00.000Z');

test('a note unlisted just now has the full 60 days left', () => {
  assert.equal(unlistedDaysLeft('2026-11-13T00:00:00.000Z', start), 60);
});

test('partial days round up, and the last day never shows as 0', () => {
  assert.equal(unlistedDaysLeft('2026-11-13T00:00:00.000Z', start + 59.5 * DAY), 1);
  assert.equal(unlistedDaysLeft('2026-11-13T00:00:00.000Z', start + 61 * DAY), 1);
  assert.equal(unlistedDaysLeft('2026-11-13T00:00:00.000Z', start + 10 * DAY + 1), 50);
});

test('an old server without unlistedAt shows no countdown', () => {
  assert.equal(unlistedDaysLeft(null, start), null);
  assert.equal(unlistedDaysLeft(undefined, start), null);
  assert.equal(unlistedDaysLeft('not-a-date', start), null);
});
