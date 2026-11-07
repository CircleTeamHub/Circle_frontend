const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Objects built inside the vm come from another realm; compare plain copies.
const plain = (value) => JSON.parse(JSON.stringify(value));

function load() {
  const requests = [];
  const mod = loadTsModule('src/features/discover/utils/moment-like.ts', {
    requireShim: (specifier) => {
      if (specifier === '@/services/api/moments') {
        return {
          setMomentLike: (id, liked) => {
            const pending = deferred();
            requests.push({ id, liked, ...pending });
            return pending.promise;
          },
        };
      }
      throw new Error(`Unexpected import: ${specifier}`);
    },
  });
  return { ...mod, requests };
}

test('a tap sends the desired state, shows it at once, then adopts the server count', async () => {
  const { toggleMomentLikeOnce, requests } = load();
  const applied = [];

  const done = toggleMomentLikeOnce('m1', { liked: false, likeCount: 5 }, (state) => applied.push(state));
  assert.deepEqual(requests.map(({ id, liked }) => [id, liked]), [['m1', true]]);
  assert.deepEqual(plain(applied), [{ liked: true, likeCount: 6 }]);

  // Someone else liked it meanwhile: the server's count wins.
  requests[0].resolve({ liked: true, likeCount: 8 });
  await done;
  assert.deepEqual(plain(applied.at(-1)), { liked: true, likeCount: 8 });
});

test('taps while a like request is in flight are dropped instead of stacking requests', async () => {
  const { toggleMomentLikeOnce, requests } = load();
  const applied = [];
  const apply = (state) => applied.push(state);

  const first = toggleMomentLikeOnce('m1', { liked: false, likeCount: 5 }, apply);
  await toggleMomentLikeOnce('m1', { liked: true, likeCount: 6 }, apply);
  await toggleMomentLikeOnce('m1', { liked: true, likeCount: 6 }, apply);
  assert.equal(requests.length, 1);
  assert.equal(applied.length, 1);

  // Another moment is not blocked.
  const other = toggleMomentLikeOnce('m2', { liked: true, likeCount: 1 }, () => {});
  assert.deepEqual(requests.map(({ id, liked }) => [id, liked]), [['m1', true], ['m2', false]]);

  requests[0].resolve({ liked: true, likeCount: 6 });
  requests[1].resolve({ liked: false, likeCount: 0 });
  await Promise.all([first, other]);

  // Once it lands the next tap goes through.
  void toggleMomentLikeOnce('m1', { liked: true, likeCount: 6 }, apply);
  assert.deepEqual(requests.map(({ liked }) => liked), [true, false, false]);
});

test('a failed like rolls back to the state before the tap and frees the moment', async () => {
  const { toggleMomentLikeOnce, requests } = load();
  const applied = [];
  const before = { liked: true, likeCount: 3 };

  const done = toggleMomentLikeOnce('m1', before, (state) => applied.push(state));
  requests[0].reject(new Error('timeout'));
  await assert.rejects(done, /timeout/);

  assert.deepEqual(plain(applied), [{ liked: false, likeCount: 2 }, before]);
  void toggleMomentLikeOnce('m1', before, () => {});
  assert.equal(requests.length, 2);
});
