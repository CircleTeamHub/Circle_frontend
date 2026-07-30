const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

test('userVipStore batches userId->vipLevel lookups behind a debounce', () => {
  const compatibility = read('src/stores/userVipStore.ts');
  const store = read('src/stores/userAppearanceStore.ts');
  assert.match(store, /fetchUserAppearances/);
  assert.match(compatibility, /export function useUserVipLevel/);
  assert.match(compatibility, /export function requestVipLevel/);
  assert.match(compatibility, /state\.levels\[normalizedId\]/);
  // Debounced batch + dedupe via the `requested` set so N names = 1 request.
  assert.match(store, /setTimeout/);
  assert.match(store, /requested/);
  assert.match(store, /MAX_IDS_PER_REQUEST/);
});

test('cached VIP levels expire via a TTL so a server-side upgrade is picked up without a restart', () => {
  const store = read('src/stores/userAppearanceStore.ts');

  // 有 TTL + 新鲜度判断，而非「曾出现在 levels 就永不再拉」。
  assert.match(store, /CACHE_TTL_MS/);
  assert.match(store, /function isFresh/);
  assert.match(store, /fetchedAt/);
  // requestVipLevel 用新鲜度而非「已缓存即跳过」决定是否重拉。
  assert.match(store, /isFresh\(normalizedId\)\s*\|\|\s*requested\.has\(normalizedId\)/);
  // 成功拉取后记录时间戳并移出 requested，TTL 过期后可重新入队。
  assert.match(store, /fetchedAt\.set\(id, now\)/);
  // 显式失效路径（已知变更时立即重建，不必等 TTL）。
  assert.match(store, /export function invalidateUserAppearances/);
});

test('userVipStore retries a transiently failed batch without needing a remount', () => {
  const store = read('src/stores/userAppearanceStore.ts');

  // 有界重试：失败分支主动重排，而不是只从 requested 移除后干等组件重挂。
  assert.match(store, /function scheduleRetry/);
  assert.match(store, /MAX_FETCH_RETRIES/);
  assert.match(store, /retryCount/);
  assert.match(store, /scheduleRetry\(failedIds\)/);
  // 成功后清零该 id 的重试计数。
  assert.match(store, /retryCount\.delete\(id\)/);
});

test('userVipStore drops a cached member when a later batch omits their id (downgrade/expiry)', () => {
  const store = read('src/stores/userAppearanceStore.ts');
  // 请求了但响应未返回的 id（= 非会员/已降级）要从 levels 删除，而不是只合并 result、
  // 让旧正值一直留着导致名字特效不消。
  assert.match(store, /hasOwnProperty\.call\(result, id\)/);
  assert.match(store, /vipLevel: 0, avatarFrame: null/);
});

test('userVipStore force-refreshes mounted names only after a real background interval', () => {
  const store = read('src/stores/userAppearanceStore.ts');
  // 真正后台停留后清理已挂载用户的新鲜度,即便仍在 TTL 内也重新请求;
  // 短暂的 inactive/active 抖动则由阈值拦住,避免控制中心触发重复请求。
  assert.match(store, /AppState\.addEventListener\('change'/);
  assert.match(store, /status !== 'active'/);
  assert.match(store, /REAL_BACKGROUND_REFRESH_MS/);
  assert.match(store, /awayDuration < REAL_BACKGROUND_REFRESH_MS/);
  assert.match(store, /fetchedAt\.delete\(userId\)/);
});

test('userVipStore drops superseded batch responses (no out-of-order stale overwrite)', () => {
  const store = read('src/stores/userAppearanceStore.ts');
  // 回前台/失效会触发对同一批 id 的第二次请求;若较新的先返回,旧响应到达时必须丢弃,
  // 否则会用可能已过期的档位覆盖回去。flush 捕获起始代次,代次变了就丢弃本响应。
  assert.match(store, /batchGeneration/);
  assert.match(store, /const startGeneration = batchGeneration/);
  assert.match(store, /if \(batchGeneration !== startGeneration\)/);
});

test('fetchVipLevels throws on a malformed response instead of caching a downgrade', () => {
  const users = read('src/services/api/users.ts');
  assert.match(users, /export async function fetchVipLevels/);
  assert.match(users, /\/user\/vip-levels/);
  assert.match(users, /method: 'POST'/);
  // 畸形响应(非对象 / 数组 / 值非有限数字)必须 THROW,让 userVipStore.flush 的 catch 走
  // 重试、保住缓存正档——绝不能兜底成 {} 被 flush 当成「这批都不是会员」的权威成功清缓存。
  assert.match(users, /typeof raw !== 'object' \|\| Array\.isArray\(raw\)/);
  assert.match(
    users,
    /throw new Error\(\s*'Malformed \/user\/vip-levels response: expected a JSON object'/,
  );
  assert.match(users, /typeof level !== 'number' \|\| !Number\.isFinite\(level\)/);
  assert.match(users, /non-numeric level for/);
  // 旧的「兜底成 {}」分支必须彻底消失。
  assert.doesNotMatch(users, /typeof raw !== 'object'\) \{\s*return \{\};/);
});

test('MemberName resolves tier from a userId via the vip cache', () => {
  const src = read('src/components/ui/member-name.tsx');
  assert.match(src, /useUserVipLevel/);
  assert.match(src, /vipLevel \?\? cachedVipLevel/);
  assert.match(src, /userId\?: string \| null/);
});

test('useUserVipLevel subscribes directly to the level projection', () => {
  const store = read('src/stores/userVipStore.ts');
  assert.match(store, /state\.levels\[normalizedId\]/);
  assert.match(store, /useRequestUserAppearance\(normalizedId\)/);
  assert.doesNotMatch(store, /useUserAppearance\(userId\)\?\.vipLevel/);
});

test('useUserVipLevel trims once for both its subscription and request key', () => {
  const requestedIds = [];
  const appearanceStore = {
    invalidateUserAppearances() {},
    requestUserAppearance() {},
    useRequestUserAppearance: (userId) => requestedIds.push(userId),
    useUserAppearance() {},
    useUserAppearanceStore: (selector) =>
      selector({ levels: { alice: 4 } }),
  };
  const { useUserVipLevel } = loadTsModule('src/stores/userVipStore.ts', {
    requireShim: (request) => {
      if (request === '@/stores/userAppearanceStore') {
        return appearanceStore;
      }
      throw new Error(`Unexpected import: ${request}`);
    },
  });

  assert.equal(useUserVipLevel(' alice '), 4);
  assert.deepEqual(requestedIds, ['alice']);
});
