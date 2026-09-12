import test from 'node:test';
import assert from 'node:assert/strict';
import { describeLastSeen, LAST_SEEN_LABEL_KEYS } from './last-seen.ts';

const NOW = Date.parse('2026-09-11T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

test('describeLastSeen: nothing to say without a usable timestamp', () => {
  assert.equal(describeLastSeen(null, NOW), null);
  assert.equal(describeLastSeen(undefined, NOW), null);
  assert.equal(describeLastSeen('', NOW), null);
  assert.equal(describeLastSeen('not-a-date', NOW), null);
});

test('describeLastSeen: under a minute is "just now", clock skew into the future included', () => {
  assert.deepEqual(describeLastSeen(ago(0), NOW), { unit: 'justNow', count: 0 });
  assert.deepEqual(describeLastSeen(ago(59_000), NOW), {
    unit: 'justNow',
    count: 0,
  });
  assert.deepEqual(describeLastSeen(ago(-5 * MIN), NOW), {
    unit: 'justNow',
    count: 0,
  });
});

test('describeLastSeen: minutes up to 59, hours up to 23, then whole days', () => {
  assert.deepEqual(describeLastSeen(ago(MIN), NOW), { unit: 'minutes', count: 1 });
  assert.deepEqual(describeLastSeen(ago(59 * MIN + 59_000), NOW), {
    unit: 'minutes',
    count: 59,
  });
  assert.deepEqual(describeLastSeen(ago(HOUR), NOW), { unit: 'hours', count: 1 });
  assert.deepEqual(describeLastSeen(ago(23 * HOUR + 59 * MIN), NOW), {
    unit: 'hours',
    count: 23,
  });
  assert.deepEqual(describeLastSeen(ago(DAY), NOW), { unit: 'days', count: 1 });
  assert.deepEqual(describeLastSeen(ago(45 * DAY + 3 * HOUR), NOW), {
    unit: 'days',
    count: 45,
  });
});

test('every bucket maps to a chat.detail label key', () => {
  for (const unit of ['justNow', 'minutes', 'hours', 'days'] as const) {
    assert.match(LAST_SEEN_LABEL_KEYS[unit], /^chat\.detail\.lastSeen/);
  }
});
