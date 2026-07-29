import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateAuthPersist, AUTH_PERSIST_VERSION } from './authPersist.ts';

test('AUTH_PERSIST_VERSION is a number zustand can compare against', () => {
  assert.equal(typeof AUTH_PERSIST_VERSION, 'number');
});

test('carries a v0 (pre-version) session forward instead of dropping it', () => {
  // 升级前（AsyncStorage 时代，无显式 version）落盘的就是这 5 个字段，
  // 迁移必须原样保留，否则已登录用户升级后会被静默登出。
  const v0State = {
    accessToken: 'access-abc',
    refreshToken: 'refresh-def',
    imToken: 'im-ghi',
    user: { id: 'u1', nickname: 'tester' },
    isAuthenticated: true,
  };

  const migrated = migrateAuthPersist(v0State, 0);

  assert.equal(migrated.accessToken, 'access-abc');
  assert.equal(migrated.refreshToken, 'refresh-def');
  assert.equal(migrated.imToken, 'im-ghi');
  assert.equal(migrated.isAuthenticated, true);
  assert.deepEqual(migrated.user, {
    id: 'u1',
    nickname: 'tester',
    avatarFrame: null,
    avatarFrameAppearance: null,
  });
});

test('returns an empty object for corrupted (non-object) persisted state', () => {
  // token 合法性由 authStore 的 onRehydrateStorage 兜底，这里只需保证形状安全
  assert.deepEqual(migrateAuthPersist(null, 0), {});
  assert.deepEqual(migrateAuthPersist('garbage', 0), {});
  assert.deepEqual(migrateAuthPersist(42, 0), {});
});

test('hydrates older users with explicit null avatar frame fields', () => {
  const migrated = migrateAuthPersist(
    {
      accessToken: 'access-abc',
      refreshToken: 'refresh-def',
      imToken: 'im-ghi',
      user: { id: 'u1', nickname: 'tester' },
      isAuthenticated: true,
    },
    1,
  );

  assert.equal(migrated.user?.avatarFrame, null);
  assert.equal(migrated.user?.avatarFrameAppearance, null);
});
