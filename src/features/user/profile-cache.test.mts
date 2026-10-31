import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROFILE_CACHE_MAX_AGE_MS,
  evictUserProfileCache,
  isProfileCacheFresh,
  readUserProfileCache,
  writeUserProfileCache,
} from './profile-cache.ts';

const profile = (id: string) => ({ id, name: id }) as never;

test('a written profile is read back for the same account', () => {
  writeUserProfileCache(1, 'u1', { profile: { value: profile('u1'), at: 100 } });
  assert.deepEqual(readUserProfileCache(1, 'u1')?.profile, {
    value: profile('u1'),
    at: 100,
  });
  assert.equal(readUserProfileCache(1, 'missing'), undefined);
});

test('parts are merged, not replaced', () => {
  writeUserProfileCache(2, 'u1', { profile: { value: profile('u1'), at: 1 } });
  writeUserProfileCache(2, 'u1', { friendStatus: { value: 'ACCEPTED', at: 2 } });
  const entry = readUserProfileCache(2, 'u1');
  assert.equal(entry?.profile?.at, 1);
  assert.equal(entry?.friendStatus?.value, 'ACCEPTED');
});

test('switching account drops everything cached for the previous one', () => {
  writeUserProfileCache(3, 'u1', { profile: { value: profile('u1'), at: 1 } });
  assert.equal(readUserProfileCache(4, 'u1'), undefined);
  assert.equal(readUserProfileCache(3, 'u1'), undefined);
});

test('keeps only the 50 most recently used people', () => {
  const epoch = 5;
  for (let i = 0; i < 50; i += 1) {
    writeUserProfileCache(epoch, `u${i}`, { profile: { value: profile(`u${i}`), at: i } });
  }
  // Reading u0 makes it the most recent, so u1 is the oldest when u50 arrives.
  readUserProfileCache(epoch, 'u0');
  writeUserProfileCache(epoch, 'u50', { profile: { value: profile('u50'), at: 50 } });
  assert.ok(readUserProfileCache(epoch, 'u0'));
  assert.equal(readUserProfileCache(epoch, 'u1'), undefined);
  assert.ok(readUserProfileCache(epoch, 'u50'));
});

test('eviction removes one person', () => {
  writeUserProfileCache(6, 'u1', { profile: { value: profile('u1'), at: 1 } });
  evictUserProfileCache(6, 'u1');
  assert.equal(readUserProfileCache(6, 'u1'), undefined);
});

test('freshness: inside the window, no clock rollback, no related write since', () => {
  const never = () => false;
  assert.equal(isProfileCacheFresh(undefined, 1_000, never), false);
  assert.equal(isProfileCacheFresh({ at: 1_000 }, 1_000 + PROFILE_CACHE_MAX_AGE_MS, never), true);
  assert.equal(isProfileCacheFresh({ at: 1_000 }, 1_001 + PROFILE_CACHE_MAX_AGE_MS, never), false);
  assert.equal(isProfileCacheFresh({ at: 1_000 }, 999, never), false);
  assert.equal(isProfileCacheFresh({ at: 1_000 }, 2_000, (since) => since <= 1_500), false);
});
