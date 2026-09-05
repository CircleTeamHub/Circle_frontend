import assert from 'node:assert/strict';
import test from 'node:test';
import { createGroupsRequestGuard } from './groups-request-guard.ts';

test('newer group loads supersede older overlapping responses', () => {
  const guard = createGroupsRequestGuard();
  const older = guard.begin(7);
  const newer = guard.begin(7);

  assert.equal(guard.isActive(older, 7), false);
  assert.equal(guard.isActive(newer, 7), true);
});

test('an account-session change invalidates the previous group response', () => {
  const guard = createGroupsRequestGuard();
  const accountA = guard.begin(7);

  assert.equal(guard.isActive(accountA, 8), false);
});
