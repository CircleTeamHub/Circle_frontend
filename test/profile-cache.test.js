const test = require('node:test');
const assert = require('node:assert/strict');
const { createPageSnapshotEnv, plain } = require('./helpers/page-snapshot-env');

const MODULE = 'src/features/user/profile-cache.ts';
const NOT_MUTATED = { '@/services/api/friends': { friendsMutatedSince: () => false } };
const profile = (id, extra = {}) => ({ id, name: id, ...extra });

function setup() {
  const env = createPageSnapshotEnv();
  const epoch = env.signIn('user-a');
  return { env, epoch, cache: env.load(MODULE, NOT_MUTATED) };
}

test('a written profile is read back for the same account', () => {
  const { epoch, cache } = setup();
  cache.writeUserProfileCache(epoch, 'u1', { profile: { value: profile('u1'), at: 100 } });
  assert.deepEqual(cache.readUserProfileCache(epoch, 'u1')?.profile, { value: profile('u1'), at: 100 });
  assert.equal(cache.readUserProfileCache(epoch, 'missing'), undefined);
});

test('parts are merged, not replaced', () => {
  const { epoch, cache } = setup();
  cache.writeUserProfileCache(epoch, 'u1', { profile: { value: profile('u1'), at: 1 } });
  cache.writeUserProfileCache(epoch, 'u1', { friendStatus: { value: 'ACCEPTED', at: 2 } });
  const entry = cache.readUserProfileCache(epoch, 'u1');
  assert.equal(entry?.profile?.at, 1);
  assert.equal(entry?.friendStatus?.value, 'ACCEPTED');
});

test('a restart restores profiles for display only: contacts stripped and never fresh', () => {
  const { env, epoch, cache } = setup();
  const contact = { phone: '13800000000', email: 'a@b.c', wechat: 'wx', qq: '1' };
  cache.writeUserProfileCache(epoch, 'u1', { profile: { value: profile('u1', { contact }), at: Date.now() } });

  const restored = env.load(MODULE, NOT_MUTATED).readUserProfileCache(epoch, 'u1')?.profile;
  assert.equal(restored?.value.name, 'u1');
  // 联系方式不落盘;恢复出来的只供首屏展示,本次会话仍要重查。
  assert.deepEqual(plain(restored?.value.contact), { phone: null, email: null, wechat: null, qq: null });
  assert.equal(restored?.restored, true);
  assert.equal(cache.isProfileCacheFresh(restored, Date.now(), () => false), false);
});

test('switching account drops everything cached for the previous one', () => {
  const { env, epoch, cache } = setup();
  cache.writeUserProfileCache(epoch, 'u1', { profile: { value: profile('u1'), at: 1 } });
  const next = env.signIn('user-b');
  assert.equal(cache.readUserProfileCache(next, 'u1'), undefined);
  assert.equal(cache.readUserProfileCache(epoch, 'u1'), undefined);
  assert.equal(env.load(MODULE, NOT_MUTATED).readUserProfileCache(next, 'u1'), undefined);
});

test('a load that started before a friend write is not cached', () => {
  const env = createPageSnapshotEnv();
  const epoch = env.signIn('user-a');
  const cache = env.load(MODULE, { '@/services/api/friends': { friendsMutatedSince: (since) => since <= 100 } });
  cache.writeUserProfileCache(epoch, 'u1', { friendSettings: { value: { remark: 'old' }, at: 100 } });
  assert.equal(cache.readUserProfileCache(epoch, 'u1'), undefined);
});

test('keeps only the 50 most recently used people', () => {
  const { epoch, cache } = setup();
  for (let i = 0; i < 50; i += 1) {
    cache.writeUserProfileCache(epoch, `u${i}`, { profile: { value: profile(`u${i}`), at: i } });
  }
  // Reading u0 makes it the most recent, so u1 is the oldest when u50 arrives.
  cache.readUserProfileCache(epoch, 'u0');
  cache.writeUserProfileCache(epoch, 'u50', { profile: { value: profile('u50'), at: 50 } });
  assert.ok(cache.readUserProfileCache(epoch, 'u0'));
  assert.equal(cache.readUserProfileCache(epoch, 'u1'), undefined);
  assert.ok(cache.readUserProfileCache(epoch, 'u50'));
});

test('eviction removes one person', () => {
  const { epoch, cache } = setup();
  cache.writeUserProfileCache(epoch, 'u1', { profile: { value: profile('u1'), at: 1 } });
  cache.evictUserProfileCache(epoch, 'u1');
  assert.equal(cache.readUserProfileCache(epoch, 'u1'), undefined);
});

test('freshness: inside the window, no clock rollback, no related write since', () => {
  const { cache } = setup();
  const never = () => false;
  const maxAge = cache.PROFILE_CACHE_MAX_AGE_MS;
  assert.equal(cache.isProfileCacheFresh(undefined, 1_000, never), false);
  assert.equal(cache.isProfileCacheFresh({ at: 1_000 }, 1_000 + maxAge, never), true);
  assert.equal(cache.isProfileCacheFresh({ at: 1_000 }, 1_001 + maxAge, never), false);
  assert.equal(cache.isProfileCacheFresh({ at: 1_000 }, 999, never), false);
  assert.equal(cache.isProfileCacheFresh({ at: 1_000 }, 2_000, (since) => since <= 1_500), false);
});

test('canonical child routes reuse and invalidate a profile cached under an account ID', () => {
  const { epoch, cache } = setup();
  cache.writeUserProfileCache(epoch, 'account-number', {
    profile: { value: profile('uuid'), at: 1 },
    friendSettings: { value: { remark: 'Known' }, at: 1 },
  });
  assert.equal(cache.readUserProfileCache(epoch, 'uuid')?.friendSettings?.value?.remark, 'Known');
  cache.writeUserProfileCache(epoch, 'uuid', { friendSettings: { value: { remark: 'Updated' }, at: 2 } });
  assert.equal(cache.readUserProfileCache(epoch, 'account-number')?.friendSettings?.value?.remark, 'Updated');
  cache.evictUserProfileCache(epoch, 'uuid');
  assert.equal(cache.readUserProfileCache(epoch, 'account-number'), undefined);
});
