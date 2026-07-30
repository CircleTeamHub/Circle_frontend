import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeUserForPersist } from './persisted-user.ts';
import type { AuthUser } from './authStore.ts';

const fullUser: AuthUser = {
  id: 'u1',
  accountId: 'a1',
  uid: '1001',
  nickname: 'Alice',
  avatarUrl: 'https://example.com/a.png',
  avatarFrame: null,
  avatarFrameAppearance: null,
  cover: null,
  email: 'alice@example.com',
  phoneNumber: '13800000000',
  wechat: 'wx-alice',
  qq: '10001',
  whatsup: '+15551230000',
  persona: 'my persona',
  helloWords: 'hi there',
  birthday: '2000-01-01',
  gender: 'female',
  role: 'user',
  status: 'active',
  lastOnline: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  city: 'Shanghai',
  vipLevel: 0,
  creditScore: 100,
  fancyNumber: false,
  displayIcons: [],
};

const SENSITIVE = [
  'email',
  'phoneNumber',
  'wechat',
  'qq',
  'whatsup',
  'persona',
  'helloWords',
  'birthday',
  'city',
] as const;

test('sanitizeUserForPersist strips sensitive PII fields', () => {
  const sanitized = sanitizeUserForPersist(fullUser) as Record<string, unknown>;
  for (const field of SENSITIVE) {
    assert.equal(sanitized[field], null, `${field} must be cleared`);
  }
});

test('sanitizeUserForPersist keeps non-sensitive display fields', () => {
  const sanitized = sanitizeUserForPersist(fullUser);
  assert.equal(sanitized.id, 'u1');
  assert.equal(sanitized.nickname, 'Alice');
  assert.equal(sanitized.avatarUrl, 'https://example.com/a.png');
  assert.equal(sanitized.vipLevel, 0);
  assert.equal(sanitized.creditScore, 100);
});

test('sanitizeUserForPersist strips signed avatar-frame URLs but keeps stable identity', () => {
  const user = {
    ...fullUser,
    avatarFrame:
      'https://cdn.example.com/frame.png?X-Amz-Signature=legacy-secret',
    avatarFrameAppearance: {
      id: 'frame-1',
      key: 'vip-gold',
      name: 'VIP Gold',
      imageUrl:
        'https://cdn.example.com/frame.png?X-Amz-Signature=secret-signature',
    },
  };

  const sanitized = sanitizeUserForPersist(user);

  assert.deepEqual(sanitized.avatarFrameAppearance, {
    id: 'frame-1',
    key: 'vip-gold',
    name: 'VIP Gold',
    imageUrl: null,
  });
  assert.equal(sanitized.avatarFrame, null);
  assert.equal(
    user.avatarFrameAppearance.imageUrl,
    'https://cdn.example.com/frame.png?X-Amz-Signature=secret-signature',
  );
});

test('sanitizeUserForPersist returns null unchanged', () => {
  assert.equal(sanitizeUserForPersist(null), null);
});

test('sanitizeUserForPersist does not mutate its input', () => {
  sanitizeUserForPersist(fullUser);
  assert.equal(fullUser.email, 'alice@example.com');
  assert.equal(fullUser.city, 'Shanghai');
});
