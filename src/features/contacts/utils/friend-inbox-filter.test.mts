import assert from 'node:assert/strict';
import test from 'node:test';

import { filterFriendInboxRows } from './friend-inbox-filter.ts';

const row = (id: string, nickname: string, accountId: string) => ({
  activity: { counterparty: { nickname, accountId } },
  unreadActivityIds: [id],
});

const rows = [
  row('1', '阿明', 'aming'),
  row('2', 'Alice', 'alice01'),
  row('3', '', 'bob_02'),
];

test('an empty or whitespace query returns the rows untouched', () => {
  assert.equal(filterFriendInboxRows(rows, ''), rows);
  assert.equal(filterFriendInboxRows(rows, '  '), rows);
});

test('matches the nickname the row renders', () => {
  assert.deepEqual(
    filterFriendInboxRows(rows, '阿明').map((item) => item.unreadActivityIds[0]),
    ['1'],
  );
});

test('matches the account id case-insensitively', () => {
  assert.deepEqual(
    filterFriendInboxRows(rows, 'ALICE').map((item) => item.unreadActivityIds[0]),
    ['2'],
  );
});

test('a blank nickname never throws and still matches by account', () => {
  assert.deepEqual(
    filterFriendInboxRows(rows, 'bob').map((item) => item.unreadActivityIds[0]),
    ['3'],
  );
});
