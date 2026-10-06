import test from 'node:test';
import assert from 'node:assert/strict';
import { isJwtExpired, readJwtExpiryMs } from './jwt-expiry.ts';

function tokenWith(payload: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256' })}.${encode(payload)}.signature`;
}

test('readJwtExpiryMs reads the exp claim without verifying the signature', () => {
  assert.equal(readJwtExpiryMs(tokenWith({ exp: 1_800_000_000 })), 1_800_000_000_000);
});

test('readJwtExpiryMs tolerates url-safe characters and missing padding', () => {
  // 昵称之类的多字节内容会让 base64url 里出现 - 和 _,且 JWT 不带 = 补位。
  const token = tokenWith({ exp: 1_800_000_000, name: '一波~~??>>' });
  assert.equal(readJwtExpiryMs(token), 1_800_000_000_000);
});

test('readJwtExpiryMs returns null for anything that is not a usable token', () => {
  assert.equal(readJwtExpiryMs(''), null);
  assert.equal(readJwtExpiryMs('not-a-jwt'), null);
  assert.equal(readJwtExpiryMs(tokenWith({ sub: 'u1' })), null);
  assert.equal(readJwtExpiryMs('a.@@@.c'), null);
});

test('isJwtExpired treats tokens inside the skew window as already expired', () => {
  const now = 1_800_000_000_000;
  assert.equal(isJwtExpired(tokenWith({ exp: now / 1000 - 1 }), now), true);
  assert.equal(isJwtExpired(tokenWith({ exp: now / 1000 + 10 }), now, 30_000), true);
  assert.equal(isJwtExpired(tokenWith({ exp: now / 1000 + 3600 }), now, 30_000), false);
  // 解不出 exp 的不判过期:让服务端去拒,客户端别凭猜测拒绝建连。
  assert.equal(isJwtExpired('opaque', now), false);
});
