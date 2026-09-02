import test from 'node:test';
import assert from 'node:assert/strict';
import { filterGroupList } from './group-list-filter.ts';

const groups = [
  {
    groupName: 'Created Group',
    introduction: 'Design team',
    ownerUserID: 'me',
    myRole: 'OWNER' as const,
  },
  {
    groupName: 'Admin Group',
    introduction: 'Operations',
    ownerUserID: 'someone-else',
    myRole: 'ADMIN' as const,
  },
  {
    groupName: 'Joined Group',
    introduction: 'Weekend hiking',
    ownerUserID: 'another-user',
    myRole: 'MEMBER' as const,
  },
];

test('filterGroupList separates created, joined, and managed groups by authoritative role', () => {
  assert.deepEqual(
    filterGroupList(groups, 'created', 'me', '').map((group) => group.groupName),
    ['Created Group'],
  );
  assert.deepEqual(
    filterGroupList(groups, 'joined', 'me', '').map((group) => group.groupName),
    ['Admin Group', 'Joined Group'],
  );
  assert.deepEqual(
    filterGroupList(groups, 'managed', 'me', '').map((group) => group.groupName),
    ['Created Group', 'Admin Group'],
  );
});

test('filterGroupList searches the selected category by name and introduction', () => {
  assert.deepEqual(
    filterGroupList(groups, 'joined', 'me', '  HIKING ').map(
      (group) => group.groupName,
    ),
    ['Joined Group'],
  );
  assert.deepEqual(
    filterGroupList(groups, 'managed', 'me', 'admin').map(
      (group) => group.groupName,
    ),
    ['Admin Group'],
  );
});
