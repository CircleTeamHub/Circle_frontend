import test from 'node:test';
import assert from 'node:assert/strict';
import {
  upsertKnownAccount,
  removeKnownAccount,
  type KnownAccount,
} from './knownAccountsLogic.ts';

function makeAccount(id: string, updatedAt = 0): KnownAccount {
  return {
    // 仅填充测试关心的字段；user 其余字段不影响列表逻辑。
    user: { id, accountId: `acc-${id}`, nickname: id } as KnownAccount['user'],
    accessToken: `at-${id}`,
    refreshToken: `rt-${id}`,
    imToken: null,
    updatedAt,
  };
}

test('upsert inserts a new account at the front (most-recent first)', () => {
  const result = upsertKnownAccount([makeAccount('a')], makeAccount('b'));
  assert.deepEqual(
    result.map((item) => item.user.id),
    ['b', 'a'],
  );
});

test('upsert dedupes by userId and moves the existing account to the front with new tokens', () => {
  const accounts = [makeAccount('a'), makeAccount('b')];
  const refreshed: KnownAccount = {
    ...makeAccount('b'),
    accessToken: 'at-b-new',
    updatedAt: 99,
  };

  const result = upsertKnownAccount(accounts, refreshed);

  assert.deepEqual(
    result.map((item) => item.user.id),
    ['b', 'a'],
  );
  assert.equal(result.length, 2);
  assert.equal(result[0].accessToken, 'at-b-new');
  assert.equal(result[0].updatedAt, 99);
});

test('upsert does not mutate the input array', () => {
  const accounts = [makeAccount('a')];
  upsertKnownAccount(accounts, makeAccount('b'));
  assert.equal(accounts.length, 1);
});

test('remove drops only the matching userId', () => {
  const accounts = [makeAccount('a'), makeAccount('b'), makeAccount('c')];
  const result = removeKnownAccount(accounts, 'b');
  assert.deepEqual(
    result.map((item) => item.user.id),
    ['a', 'c'],
  );
});

test('remove is a no-op when the userId is absent', () => {
  const accounts = [makeAccount('a')];
  const result = removeKnownAccount(accounts, 'missing');
  assert.deepEqual(
    result.map((item) => item.user.id),
    ['a'],
  );
});
