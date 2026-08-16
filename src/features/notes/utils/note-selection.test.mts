import test from 'node:test';
import assert from 'node:assert/strict';
import {
  commonGroupIds,
  pruneSelection,
  toggleId,
  toggleSelectAll,
} from './note-selection.ts';

test('toggleId adds an unselected id and removes a selected one immutably', () => {
  const initial = ['a'];

  const added = toggleId(initial, 'b');
  assert.deepEqual(added, ['a', 'b']);

  const removed = toggleId(added, 'a');
  assert.deepEqual(removed, ['b']);

  // 原数组不可被就地修改
  assert.deepEqual(initial, ['a']);
});

test('toggleSelectAll selects all visible ids when any is missing', () => {
  assert.deepEqual(toggleSelectAll([], ['a', 'b']), ['a', 'b']);
  assert.deepEqual(toggleSelectAll(['a'], ['a', 'b']), ['a', 'b']);
  // 跨 tab 遗留的隐藏选中项会被替换成当前可见集合
  assert.deepEqual(toggleSelectAll(['hidden'], ['a']), ['a']);
});

test('toggleSelectAll clears when every visible id is already selected', () => {
  assert.deepEqual(toggleSelectAll(['a', 'b'], ['a', 'b']), []);
  // 可见列表为空时不进入「全选」状态
  assert.deepEqual(toggleSelectAll([], []), []);
});

test('pruneSelection drops ids that no longer exist after a reload', () => {
  assert.deepEqual(pruneSelection(['a', 'gone', 'b'], ['a', 'b', 'c']), [
    'a',
    'b',
  ]);
  assert.deepEqual(pruneSelection(['x'], []), []);
});

test('commonGroupIds returns the intersection in first-note order', () => {
  const notes = [
    { groups: [{ id: 'g1' }, { id: 'g2' }, { id: 'g3' }] },
    { groups: [{ id: 'g3' }, { id: 'g1' }] },
    { groups: [{ id: 'g1' }, { id: 'g3' }, { id: 'g9' }] },
  ];
  assert.deepEqual(commonGroupIds(notes), ['g1', 'g3']);
});

test('commonGroupIds handles empty inputs and disjoint groups', () => {
  assert.deepEqual(commonGroupIds([]), []);
  assert.deepEqual(
    commonGroupIds([{ groups: [{ id: 'g1' }] }, { groups: [] }]),
    [],
  );
});
