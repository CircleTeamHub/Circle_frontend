const test = require('node:test');
const assert = require('node:assert/strict');
const { createPageSnapshotEnv } = require('./helpers/page-snapshot-env');

const MODULE = 'src/features/chat/group-info-cache.ts';
const NOT_MUTATED = { '@/features/chat/utils/group-reload-key': { groupOrCircleMutatedSince: () => false } };
const member = (userId) => ({ userId });

function setup() {
  const env = createPageSnapshotEnv();
  const epoch = env.signIn('user-a');
  return { env, epoch, cache: env.load(MODULE, NOT_MUTATED) };
}

test('a second visit reads back what the first one loaded', () => {
  const { epoch, cache } = setup();
  cache.writeGroupInfoCache(epoch, 'circle:a', {
    groupInfo: { name: '圈 A', notice: '公告', memberCount: 2 },
  });
  cache.writeGroupInfoCache(epoch, 'circle:a', { members: [member('u1'), member('u2')] });
  const hit = cache.readGroupInfoCache(epoch, 'circle:a');
  assert.equal(hit?.groupInfo?.name, '圈 A');
  assert.equal(hit?.members?.length, 2);
});

test('the same account gets its groups back after a restart, without temp rooms or validated access', () => {
  const { env, epoch, cache } = setup();
  cache.writeGroupInfoCache(epoch, 'standalone:g1', {
    members: [member('u1')],
    validatedAccess: { userID: 'user-a', role: 'OWNER', roleHint: null, checkedAt: 1 },
  });
  cache.writeGroupInfoCache(epoch, 'temp:room', { members: [member('guest')] });

  const restarted = env.load(MODULE, NOT_MUTATED);
  const restored = restarted.readGroupInfoCache(epoch, 'standalone:g1');
  assert.equal(restored?.members?.length, 1);
  // 权限只认这次会话里活体查询的结果,不从盘里恢复。
  assert.equal(restored?.validatedAccess, undefined);
  assert.equal(restarted.readGroupInfoCache(epoch, 'temp:room'), undefined);
});

test('switching account never shows the previous account groups, in memory or on disk', () => {
  const { env, epoch, cache } = setup();
  cache.writeGroupInfoCache(epoch, 'circle:b', { members: [member('u1')] });

  const next = env.signIn('user-b');
  assert.equal(cache.readGroupInfoCache(next, 'circle:b'), undefined);
  // 旧 epoch 的读写都不再生效。
  assert.equal(cache.readGroupInfoCache(epoch, 'circle:b'), undefined);
  assert.equal(env.load(MODULE, NOT_MUTATED).readGroupInfoCache(next, 'circle:b'), undefined);
});

test('clearing page snapshots drops memory too and rejects a write from a request started before it', () => {
  const { env, epoch, cache } = setup();
  cache.writeGroupInfoCache(epoch, 'circle:c', { members: [member('u1')] });
  const staleRevision = env.snapshots.getPageSnapshotRevision();

  env.snapshots.clearPageSnapshots();
  assert.equal(cache.readGroupInfoCache(epoch, 'circle:c'), undefined);
  cache.writeGroupInfoCache(epoch, 'circle:c', { members: [member('u2')] }, staleRevision);
  assert.equal(cache.readGroupInfoCache(epoch, 'circle:c'), undefined);
});

test('a load that started before a group write is not cached', () => {
  const env = createPageSnapshotEnv();
  const epoch = env.signIn('user-a');
  const cache = env.load(MODULE, {
    '@/features/chat/utils/group-reload-key': { groupOrCircleMutatedSince: (since) => since <= 100 },
  });
  cache.writeGroupInfoCache(epoch, 'circle:d', { members: [member('u1')] }, undefined, 100);
  assert.equal(cache.readGroupInfoCache(epoch, 'circle:d'), undefined);
  cache.writeGroupInfoCache(epoch, 'circle:d', { members: [member('u1')] }, undefined, 200);
  assert.equal(cache.readGroupInfoCache(epoch, 'circle:d')?.members?.length, 1);
});

test('evicting one group leaves the others', () => {
  const { epoch, cache } = setup();
  cache.writeGroupInfoCache(epoch, 'circle:e', { members: [member('u1')] });
  cache.writeGroupInfoCache(epoch, 'circle:f', { members: [member('u2')] });
  cache.evictGroupInfoCache(epoch, 'circle:e');
  assert.equal(cache.readGroupInfoCache(epoch, 'circle:e'), undefined);
  assert.equal(cache.readGroupInfoCache(epoch, 'circle:f')?.members?.length, 1);
});

test('only the most recently viewed groups are kept', () => {
  const { epoch, cache } = setup();
  for (let i = 0; i < 25; i += 1) {
    cache.writeGroupInfoCache(epoch, `circle:${i}`, { members: [] });
  }
  assert.equal(cache.readGroupInfoCache(epoch, 'circle:0'), undefined);
  assert.ok(cache.readGroupInfoCache(epoch, 'circle:24'));
});
