const test = require('node:test');
const assert = require('node:assert/strict');
const { createPageSnapshotEnv, plain } = require('./helpers/page-snapshot-env');

const MODULE = 'src/features/groups/group-admissions-cache.ts';
const mutated = { since: () => false };
const OVERRIDES = {
  '@/features/chat/utils/group-reload-key': { groupOrCircleMutatedSince: (since) => mutated.since(since) },
};
const never = () => false;
const page = (...ids) => ({
  items: ids.map((id) => ({ id, group: { name: id } })),
  circleInvitations: [{ id: 'c1' }],
  nextCursor: 'next',
});

function setup() {
  mutated.since = () => false;
  const env = createPageSnapshotEnv();
  const epoch = env.signIn('user-a');
  return { env, epoch, cache: env.load(MODULE, OVERRIDES) };
}

test('nothing is cached before the first load', () => {
  const { epoch, cache } = setup();
  assert.equal(cache.readGroupAdmissionsSnapshot(epoch, undefined, never), null);
});

test('the inbox reads back its last first page, also after a restart', () => {
  const { env, epoch, cache } = setup();
  cache.writeGroupAdmissionsSnapshot(epoch, undefined, page('a1', 'a2'), 100, 0);
  assert.deepEqual(plain(env.load(MODULE, OVERRIDES).readGroupAdmissionsSnapshot(epoch, undefined, never)), page('a1', 'a2'));
});

test('the inbox and each scoped group view keep separate snapshots', () => {
  const { epoch, cache } = setup();
  cache.writeGroupAdmissionsSnapshot(epoch, undefined, page('inbox'), 100, 0);
  cache.writeGroupAdmissionsSnapshot(epoch, 'g1', page('scoped'), 100, 0);
  assert.equal(cache.readGroupAdmissionsSnapshot(epoch, undefined, never).items[0].id, 'inbox');
  assert.equal(cache.readGroupAdmissionsSnapshot(epoch, 'g1', never).items[0].id, 'scoped');
  assert.equal(cache.readGroupAdmissionsSnapshot(epoch, 'g2', never), null);
});

// 审批、接受、标记已读都记群/圈子写请求：那之后这份列表可能把已处理的邀请画回「待处理」。
test('a group or circle write after the load means the snapshot is not used', () => {
  const { epoch, cache } = setup();
  cache.writeGroupAdmissionsSnapshot(epoch, undefined, page('a1'), 100, 0);
  const seen = [];
  assert.equal(cache.readGroupAdmissionsSnapshot(epoch, undefined, (since) => (seen.push(since), true)), null);
  assert.deepEqual(seen, [100]);
});

test('a load that started before a write, or before the snapshots were cleared, is not saved', () => {
  const { env, epoch, cache } = setup();
  mutated.since = (since) => since <= 100;
  cache.writeGroupAdmissionsSnapshot(epoch, undefined, page('a1'), 100, 0);
  assert.equal(cache.readGroupAdmissionsSnapshot(epoch, undefined, never), null);

  mutated.since = () => false;
  cache.writeGroupAdmissionsSnapshot(epoch, undefined, page('a1'), 200, -1); // 请求发出后快照被清过
  assert.equal(env.load(MODULE, OVERRIDES).readGroupAdmissionsSnapshot(epoch, undefined, never), null);
});

test('switching account drops the previous account snapshot', () => {
  const { env, epoch, cache } = setup();
  cache.writeGroupAdmissionsSnapshot(epoch, undefined, page('a1'), 100, 0);
  const next = env.signIn('user-b');
  assert.equal(cache.readGroupAdmissionsSnapshot(next, undefined, never), null);
  assert.equal(cache.readGroupAdmissionsSnapshot(epoch, undefined, never), null);
  // 旧 epoch 的写也不再生效。
  cache.writeGroupAdmissionsSnapshot(epoch, undefined, page('stale'), 300, 0);
  assert.equal(cache.readGroupAdmissionsSnapshot(next, undefined, never), null);
});
