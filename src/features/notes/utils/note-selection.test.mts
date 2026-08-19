import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyGroupMembershipChanges,
  groupMembershipStates,
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

test('groupMembershipStates classifies each group as all/some/none', () => {
  const notes = [
    { groups: [{ id: 'g1' }, { id: 'g2' }] },
    { groups: [{ id: 'g1' }] },
  ];
  const groups = [{ id: 'g1' }, { id: 'g2' }, { id: 'g3' }];
  const states = groupMembershipStates(notes, groups);
  assert.equal(states.get('g1'), 'all');
  assert.equal(states.get('g2'), 'some');
  assert.equal(states.get('g3'), 'none');
});

test('groupMembershipStates marks everything none when there are no notes', () => {
  const states = groupMembershipStates([], [{ id: 'g1' }]);
  assert.equal(states.get('g1'), 'none');
});

test('applyGroupMembershipChanges touches only the changed groups per note', () => {
  const notes = [
    { id: 'n1', groups: [{ id: 'g1' }, { id: 'g2' }] },
    { id: 'n2', groups: [{ id: 'g2' }] },
    { id: 'n3', groups: [{ id: 'g3' }] },
  ];
  const ops = applyGroupMembershipChanges(notes, { g3: 'add', g2: 'remove' });
  // n3 本来就在 g3、也不在 g2：净变化为零，跳过不发请求。
  assert.deepEqual(ops, [
    { id: 'n1', groupIds: ['g1', 'g3'] },
    { id: 'n2', groupIds: ['g3'] },
  ]);
});

test('applyGroupMembershipChanges returns empty when nothing effectively changes', () => {
  const notes = [{ id: 'n1', groups: [{ id: 'g1' }] }];
  assert.deepEqual(applyGroupMembershipChanges(notes, { g1: 'add' }), []);
  assert.deepEqual(applyGroupMembershipChanges(notes, {}), []);
});

test('applyGroupMembershipChanges keeps untouched order and appends additions', () => {
  const notes = [{ id: 'n1', groups: [{ id: 'g2' }, { id: 'g1' }] }];
  const ops = applyGroupMembershipChanges(notes, { g9: 'add' });
  assert.deepEqual(ops, [{ id: 'n1', groupIds: ['g2', 'g1', 'g9'] }]);
});
