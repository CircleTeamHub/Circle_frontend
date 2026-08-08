import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLocalDaySearchWindow } from './chat-history-date-window.ts';

process.env.TZ = 'America/Los_Angeles';

test('uses the next local midnight so DST transition days keep their real length', () => {
  const springForward = resolveLocalDaySearchWindow('2026-03-08');
  const fallBack = resolveLocalDaySearchWindow('2026-11-01');

  assert.ok(springForward);
  assert.ok(fallBack);
  assert.equal(springForward.periodSeconds, 23 * 60 * 60);
  assert.equal(fallBack.periodSeconds, 25 * 60 * 60);
});

test('rejects invalid calendar dates instead of rolling them into another day', () => {
  assert.equal(resolveLocalDaySearchWindow('2026-02-30'), null);
  assert.equal(resolveLocalDaySearchWindow('not-a-date'), null);
});
