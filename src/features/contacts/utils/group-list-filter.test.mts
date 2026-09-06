import assert from 'node:assert/strict';
import test from 'node:test';

import { filterGroupsByQuery } from './group-list-filter.ts';

const groups = [
  { groupID: '1', groupName: '读书会', introduction: '每周三晚上' },
  { groupID: '2', groupName: 'Weekend Hike', introduction: null },
  { groupID: '3', groupName: '同事群', introduction: 'Weekend lunch club' },
];

test('an empty or whitespace query returns the list untouched', () => {
  assert.equal(filterGroupsByQuery(groups, ''), groups);
  assert.equal(filterGroupsByQuery(groups, '   '), groups);
});

test('matches on the group name', () => {
  assert.deepEqual(
    filterGroupsByQuery(groups, '读书').map((group) => group.groupID),
    ['1'],
  );
});

test('matches on the introduction, which the row also renders', () => {
  assert.deepEqual(
    filterGroupsByQuery(groups, '每周三').map((group) => group.groupID),
    ['1'],
  );
});

test('matches case-insensitively across both fields', () => {
  assert.deepEqual(
    filterGroupsByQuery(groups, 'WEEKEND').map((group) => group.groupID),
    ['2', '3'],
  );
});

test('a missing introduction never throws', () => {
  assert.deepEqual(filterGroupsByQuery(groups, 'hike').map((g) => g.groupID), [
    '2',
  ]);
});

test('no match yields an empty list rather than the full one', () => {
  assert.deepEqual(filterGroupsByQuery(groups, '不存在的群'), []);
});

test('surrounding whitespace in the query is ignored', () => {
  assert.deepEqual(
    filterGroupsByQuery(groups, '  读书  ').map((group) => group.groupID),
    ['1'],
  );
});
