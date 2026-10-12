import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveManagedWorkStatus } from './managed-work-status.ts';

test('unset, null and legacy-missing work status stay unset instead of WORKING', () => {
  assert.equal(resolveManagedWorkStatus({ workStatus: 'UNSET' }), 'UNSET');
  assert.equal(resolveManagedWorkStatus({ workStatus: null }), 'UNSET');
  assert.equal(resolveManagedWorkStatus({}), 'UNSET');
});

test('explicit WORKING and CLOSED pass through', () => {
  assert.equal(resolveManagedWorkStatus({ workStatus: 'WORKING' }), 'WORKING');
  assert.equal(resolveManagedWorkStatus({ workStatus: 'CLOSED' }), 'CLOSED');
});
