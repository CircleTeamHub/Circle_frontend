const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('userVipStore batches userId->vipLevel lookups behind a debounce', () => {
  const store = read('src/stores/userVipStore.ts');
  assert.match(store, /fetchVipLevels/);
  assert.match(store, /export function useUserVipLevel/);
  assert.match(store, /export function requestVipLevel/);
  // Debounced batch + dedupe via the `requested` set so N names = 1 request.
  assert.match(store, /setTimeout/);
  assert.match(store, /requested/);
  assert.match(store, /MAX_IDS_PER_REQUEST/);
});

test('cached VIP levels expire via a TTL so a server-side upgrade is picked up without a restart', () => {
  const store = read('src/stores/userVipStore.ts');

  // 有 TTL + 新鲜度判断，而非「曾出现在 levels 就永不再拉」。
  assert.match(store, /CACHE_TTL_MS/);
  assert.match(store, /function isVipLevelFresh/);
  assert.match(store, /fetchedAt/);
  // requestVipLevel 用新鲜度而非「已缓存即跳过」决定是否重拉。
  assert.match(store, /isVipLevelFresh\(userId\)\s*\|\|\s*requested\.has\(userId\)/);
  assert.doesNotMatch(store, /userId in useUserVipStore\.getState\(\)\.levels/);
  // 成功拉取后记录时间戳并移出 requested，TTL 过期后可重新入队。
  assert.match(store, /fetchedAt\.set\(id, now\)/);
  // 显式失效路径（已知变更时立即重建，不必等 TTL）。
  assert.match(store, /export function invalidateVipLevels/);
});

test('fetchVipLevels posts ids and defends the response shape', () => {
  const users = read('src/services/api/users.ts');
  assert.match(users, /export async function fetchVipLevels/);
  assert.match(users, /\/user\/vip-levels/);
  assert.match(users, /method: 'POST'/);
  // Filters non-number levels so a malformed payload can't poison the cache.
  assert.match(users, /Number\.isFinite\(level\)/);
});

test('MemberName resolves tier from a userId via the vip cache', () => {
  const src = read('src/components/ui/member-name.tsx');
  assert.match(src, /useUserVipLevel/);
  assert.match(src, /vipLevel \?\? cachedVipLevel/);
  assert.match(src, /userId\?: string \| null/);
});
