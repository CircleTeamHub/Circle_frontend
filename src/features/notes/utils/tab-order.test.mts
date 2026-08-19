import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NOTES_TAB_ALL,
  NOTES_TAB_UNGROUPED,
  mergeTabOrder,
} from './tab-order.ts';

test('empty stored order falls back to all/ungrouped then server group order', () => {
  assert.deepEqual(mergeTabOrder([], ['g1', 'g2']), [
    NOTES_TAB_ALL,
    NOTES_TAB_UNGROUPED,
    'g1',
    'g2',
  ]);
});

test('stored order is respected verbatim, fixed tabs can sit anywhere', () => {
  assert.deepEqual(
    mergeTabOrder(['g2', NOTES_TAB_ALL, 'g1', NOTES_TAB_UNGROUPED], ['g1', 'g2']),
    ['g2', NOTES_TAB_ALL, 'g1', NOTES_TAB_UNGROUPED],
  );
});

test('deleted groups drop out and new groups append at the end', () => {
  assert.deepEqual(
    mergeTabOrder([NOTES_TAB_ALL, 'gone', NOTES_TAB_UNGROUPED, 'g1'], ['g1', 'g9']),
    [NOTES_TAB_ALL, NOTES_TAB_UNGROUPED, 'g1', 'g9'],
  );
});

test('missing fixed tabs are restored: all to the front, ungrouped right after', () => {
  assert.deepEqual(mergeTabOrder(['g1'], ['g1']), [
    NOTES_TAB_ALL,
    NOTES_TAB_UNGROUPED,
    'g1',
  ]);
  assert.deepEqual(mergeTabOrder(['g1', NOTES_TAB_ALL], ['g1']), [
    'g1',
    NOTES_TAB_ALL,
    NOTES_TAB_UNGROUPED,
  ]);
});

test('duplicate stored ids keep only the first occurrence', () => {
  assert.deepEqual(
    mergeTabOrder([NOTES_TAB_ALL, 'g1', 'g1', NOTES_TAB_UNGROUPED], ['g1']),
    [NOTES_TAB_ALL, 'g1', NOTES_TAB_UNGROUPED],
  );
});
