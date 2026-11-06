const test = require('node:test');
const assert = require('node:assert/strict');
const { createPageSnapshotEnv, plain } = require('./helpers/page-snapshot-env');

const MODULE = 'src/features/contacts/friend-activities-cache.ts';
const NOT_MUTATED = { '@/services/api/friends': { friendsMutatedSince: () => false } };
const activity = (id) => ({ id });
const never = () => false;

function setup() {
  const env = createPageSnapshotEnv();
  const epoch = env.signIn('user-a');
  return { env, epoch, cache: env.load(MODULE, NOT_MUTATED) };
}

test('nothing is cached before the first load', () => {
  const { epoch, cache } = setup();
  assert.equal(cache.readFriendActivitiesCache(epoch, never), null);
});

test('the next visit reads back the last loaded list, also after a restart', () => {
  const { env, epoch, cache } = setup();
  cache.writeFriendActivitiesCache(epoch, [activity('a1'), activity('a2')], 100);
  assert.deepEqual(cache.readFriendActivitiesCache(epoch, never), [activity('a1'), activity('a2')]);
  assert.deepEqual(plain(env.load(MODULE, NOT_MUTATED).readFriendActivitiesCache(epoch, never)), [
    activity('a1'),
    activity('a2'),
  ]);
});

// 详情页同意/拒绝、发出新申请都记好友写请求:那之后这份列表可能把已处理的申请画回「待处理」。
test('a friend write after the load means the cached list is not used', () => {
  const { epoch, cache } = setup();
  cache.writeFriendActivitiesCache(epoch, [activity('a1')], 100);
  const seen = [];
  const mutatedSince = (since) => {
    seen.push(since);
    return true;
  };
  assert.equal(cache.readFriendActivitiesCache(epoch, mutatedSince), null);
  // 按请求发出的时刻判断,不是按写入缓存的时刻。
  assert.deepEqual(seen, [100]);
});

test('a load that started before a friend write is kept in memory but not written to disk', () => {
  const env = createPageSnapshotEnv();
  const epoch = env.signIn('user-a');
  const overrides = { '@/services/api/friends': { friendsMutatedSince: (since) => since <= 100 } };
  env.load(MODULE, overrides).writeFriendActivitiesCache(epoch, [activity('a1')], 100);
  assert.equal(env.load(MODULE, NOT_MUTATED).readFriendActivitiesCache(epoch, never), null);
});

test('switching account drops the previous account list', () => {
  const { env, epoch, cache } = setup();
  cache.writeFriendActivitiesCache(epoch, [activity('a1')], 100);
  const next = env.signIn('user-b');
  assert.equal(cache.readFriendActivitiesCache(next, never), null);
  // 旧 epoch 的读不再生效。
  assert.equal(cache.readFriendActivitiesCache(epoch, never), null);
});
