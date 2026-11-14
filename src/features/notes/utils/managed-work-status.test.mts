import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveManagedWorkStatus } from './managed-work-status.ts';

test('unset, null and legacy-missing work status stay unset instead of WORKING', () => {
  assert.equal(resolveManagedWorkStatus({ workStatus: 'UNSET' }), 'UNSET');
  assert.equal(resolveManagedWorkStatus({ workStatus: null }), 'UNSET');
  assert.equal(resolveManagedWorkStatus({}), 'UNSET');
});

test('explicit WORKING, CLOSED and OFF_SHELF pass through', () => {
  assert.equal(resolveManagedWorkStatus({ workStatus: 'WORKING' }), 'WORKING');
  assert.equal(resolveManagedWorkStatus({ workStatus: 'CLOSED' }), 'CLOSED');
  assert.equal(resolveManagedWorkStatus({ workStatus: 'OFF_SHELF' }), 'OFF_SHELF');
});

test('a 下架 note (status UNLISTED) shows as OFF_SHELF whatever its old work status was', () => {
  assert.equal(resolveManagedWorkStatus({ status: 'UNLISTED', workStatus: 'WORKING' }), 'OFF_SHELF');
  assert.equal(resolveManagedWorkStatus({ status: 'UNLISTED', workStatus: null }), 'OFF_SHELF');
  assert.equal(resolveManagedWorkStatus({ status: 'ACTIVE', workStatus: 'CLOSED' }), 'CLOSED');
});
