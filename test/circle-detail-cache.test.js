const test = require('node:test');
const assert = require('node:assert/strict');
const { createPageSnapshotEnv } = require('./helpers/page-snapshot-env');

const MODULE = 'src/features/discover/circle-detail-cache.ts';
const NOT_MUTATED = { '@/features/chat/utils/group-reload-key': { groupOrCircleMutatedSince: () => false } };
const circle = (id, extra = {}) => ({ id, name: `圈 ${id}`, myStatus: 'ACTIVE', myRole: 'MEMBER', ...extra });
const invitation = (id) => ({ id, status: 'PENDING' });

function setup() {
  const env = createPageSnapshotEnv();
  const epoch = env.signIn('user-a');
  return { env, epoch, cache: env.load(MODULE, NOT_MUTATED) };
}

test('a second visit reads back the circle and my pending application', () => {
  const { epoch, cache } = setup();
  cache.writeCircleDetailCache(epoch, 'a', { circle: circle('a') });
  cache.writeCircleDetailCache(epoch, 'a', { invitation: invitation('inv-a') });
  const hit = cache.readCircleDetailCache(epoch, 'a');
  assert.equal(hit?.circle?.name, '圈 a');
  assert.equal(hit?.invitation?.id, 'inv-a');
  assert.equal(cache.readCircleDetailCache(epoch, 'missing'), undefined);
});

test('a later load replaces the circle but keeps the application it did not fetch', () => {
  const { epoch, cache } = setup();
  cache.writeCircleDetailCache(epoch, 'a', { circle: circle('a'), invitation: invitation('inv-a') });
  cache.writeCircleDetailCache(epoch, 'a', { circle: circle('a', { myStatus: 'PENDING' }) });
  const hit = cache.readCircleDetailCache(epoch, 'a');
  assert.equal(hit?.circle?.myStatus, 'PENDING');
  assert.equal(hit?.invitation?.id, 'inv-a');
});

test('the same account gets its circles back after a restart', () => {
  const { env, epoch, cache } = setup();
  cache.writeCircleDetailCache(epoch, 'r', { circle: circle('r') });
  assert.equal(env.load(MODULE, NOT_MUTATED).readCircleDetailCache(epoch, 'r')?.circle?.id, 'r');
});

test('switching account drops every cached circle, in memory and on disk', () => {
  const { env, epoch, cache } = setup();
  cache.writeCircleDetailCache(epoch, 'b', { circle: circle('b') });
  const next = env.signIn('user-b');
  assert.equal(cache.readCircleDetailCache(next, 'b'), undefined);
  // 旧 epoch 不再生效(成员关系是按账号的)。
  assert.equal(cache.readCircleDetailCache(epoch, 'b'), undefined);
  assert.equal(env.load(MODULE, NOT_MUTATED).readCircleDetailCache(next, 'b'), undefined);
});

test('a load that started before a circle or group write is not cached', () => {
  const env = createPageSnapshotEnv();
  const epoch = env.signIn('user-a');
  const cache = env.load(MODULE, {
    '@/features/chat/utils/group-reload-key': { groupOrCircleMutatedSince: (since) => since <= 100 },
  });
  cache.writeCircleDetailCache(epoch, 'w', { circle: circle('w'), at: 100 });
  assert.equal(cache.readCircleDetailCache(epoch, 'w'), undefined);
  cache.writeCircleDetailCache(epoch, 'w', { circle: circle('w'), at: 200 });
  assert.equal(cache.readCircleDetailCache(epoch, 'w')?.circle?.id, 'w');
});

test('a local avatar/cover change patches the cached circle in place', () => {
  const { epoch, cache } = setup();
  cache.writeCircleDetailCache(epoch, 'c', { circle: circle('c', { cover: 'old.jpg' }) });
  cache.patchCachedCircle(epoch, 'c', { cover: 'new.jpg' });
  const hit = cache.readCircleDetailCache(epoch, 'c');
  assert.equal(hit?.circle?.cover, 'new.jpg');
  assert.equal(hit?.circle?.name, '圈 c');
});

test('patching a circle that was never cached does not invent a half-filled one', () => {
  const { epoch, cache } = setup();
  cache.patchCachedCircle(epoch, 'never', { avatarUrl: 'a.jpg' });
  assert.equal(cache.readCircleDetailCache(epoch, 'never'), undefined);
});

test('evicting one circle leaves the others', () => {
  const { epoch, cache } = setup();
  cache.writeCircleDetailCache(epoch, 'd', { circle: circle('d') });
  cache.writeCircleDetailCache(epoch, 'e', { circle: circle('e') });
  cache.evictCircleDetailCache(epoch, 'd');
  assert.equal(cache.readCircleDetailCache(epoch, 'd'), undefined);
  assert.equal(cache.readCircleDetailCache(epoch, 'e')?.circle?.id, 'e');
});

test('only the most recently viewed circles are kept', () => {
  const { epoch, cache } = setup();
  cache.writeCircleDetailCache(epoch, 'circle:0', { circle: circle('0') });
  for (let i = 1; i < 60; i += 1) {
    cache.writeCircleDetailCache(epoch, `circle:${i}`, { circle: circle(String(i)) });
    // 一直在看的那个圈子算最近使用,不会被后来的挤掉。
    cache.readCircleDetailCache(epoch, 'circle:0');
  }
  assert.equal(cache.readCircleDetailCache(epoch, 'circle:1'), undefined);
  assert.equal(cache.readCircleDetailCache(epoch, 'circle:0')?.circle?.id, '0');
  assert.equal(cache.readCircleDetailCache(epoch, 'circle:59')?.circle?.id, '59');
});
