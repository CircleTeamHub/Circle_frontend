const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function mmkvShim() {
  const backing = new Map();
  return {
    mmkvJsonStorage: {
      getItem: (key) => backing.get(key) ?? null,
      setItem: (key, value) => backing.set(key, value),
      removeItem: (key) => backing.delete(key),
    },
    backing,
  };
}

// ---------------------------------------------------------------------------
// store 级行为：resetForLogout 真正清空账号级状态
// ---------------------------------------------------------------------------

test('local-unread / chat-preferences / discover-filter 的 resetForLogout 清空账号级状态 (#97)', () => {
  const unreadShims = {
    zustand: require('zustand'),
    'zustand/middleware': require('zustand/middleware'),
    '@/storage': mmkvShim(),
    '@/features/messages/utils/local-unread': loadTsModule(
      'src/features/messages/utils/local-unread.ts',
    ),
  };
  const { useLocalUnreadStore } = loadTsModule(
    'src/features/messages/store/use-local-unread-store.ts',
    {
      requireShim: (specifier) => {
        if (unreadShims[specifier]) return unreadShims[specifier];
        throw new Error(`unexpected import: ${specifier}`);
      },
    },
  );
  useLocalUnreadStore.getState().markUnread('conv-a');
  assert.ok(useLocalUnreadStore.getState().overrides['conv-a']);
  useLocalUnreadStore.getState().resetForLogout();
  assert.deepEqual(
    JSON.parse(JSON.stringify(useLocalUnreadStore.getState().overrides)),
    {},
  );

  const prefShims = {
    zustand: require('zustand'),
    'zustand/middleware': require('zustand/middleware'),
    '@/storage': mmkvShim(),
  };
  const { useChatPreferencesStore } = loadTsModule(
    'src/features/chat/store/use-chat-preferences-store.ts',
    {
      requireShim: (specifier) => {
        if (prefShims[specifier]) return prefShims[specifier];
        throw new Error(`unexpected import: ${specifier}`);
      },
    },
  );
  useChatPreferencesStore
    .getState()
    .setChatBackgroundPreference('conv-a', { mode: 'preset', presetId: 'p1' });
  useChatPreferencesStore.getState().resetForLogout();
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        useChatPreferencesStore.getState().backgroundsByConversationID,
      ),
    ),
    {},
  );

  const filterShims = {
    zustand: require('zustand'),
    'zustand/middleware': require('zustand/middleware'),
    '@/storage': mmkvShim(),
    '@/features/discover/utils/circle-filter-selection': loadTsModule(
      'src/features/discover/utils/circle-filter-selection.ts',
    ),
  };
  const { useDiscoverFilterStore } = loadTsModule(
    'src/features/discover/store/use-discover-filter-store.ts',
    {
      requireShim: (specifier) => {
        if (filterShims[specifier]) return filterShims[specifier];
        throw new Error(`unexpected import: ${specifier}`);
      },
    },
  );
  useDiscoverFilterStore.getState().setDraftCircleIds(['c1']);
  useDiscoverFilterStore.getState().saveFilter();
  assert.equal(useDiscoverFilterStore.getState().appliedCircleIds.length, 1);
  useDiscoverFilterStore.getState().resetForLogout();
  assert.equal(useDiscoverFilterStore.getState().appliedCircleIds.length, 0);
  assert.equal(useDiscoverFilterStore.getState().draftCircleIds.length, 0);
});

// ---------------------------------------------------------------------------
// session.ts：显式清理清单接进 performClearLocalSession
// ---------------------------------------------------------------------------

test('登出清理清单点名四个账号级持久化 store，幸存者留有名单 (#97)', () => {
  const session = read('src/services/auth/session.ts');

  assert.match(session, /ACCOUNT_SCOPED_STORE_LOADERS/);
  assert.match(session, /use-local-unread-store/);
  assert.match(session, /use-chat-preferences-store/);
  assert.match(session, /use-discover-filter-store/);
  assert.match(session, /use-circle-shortcut-order-store/);
  // 幸存者是显式决定，不是遗漏
  assert.match(session, /circle-im-app-settings/);
  assert.match(session, /circle-im-notification-feedback/);
  assert.match(session, /circle-im-circle-notification/);
  // 清单在 performClearLocalSession 里被消费：先重置内存再删持久化
  assert.match(
    session,
    /await clearAccountScopedPersistedStores\(clearedSessionEpoch\)/,
  );
  assert.match(session, /resetForLogout\(\)/);
  assert.match(session, /clearStorage\?\.\(\)/);
});

test('session.ts 惰性加载 discover / vip store，避免与 api client 的模块环 (#131 P1)', () => {
  const session = read('src/services/auth/session.ts');

  // 静态 import 这两个会成环:session.ts → use-discover-store/userVipStore → services/api/*
  // → api/client.ts → session.ts。api/client 求值时 registerLogoutHandler,而 session.ts 尚未
  // 初始化完、logoutHandlers 未就绪,冷启动可能崩。改为登出流程里按需 import() 破环(与
  // loadMessageGroupsStore / loadCirclesStore 同一模式)。
  assert.doesNotMatch(
    session,
    /^import\s*\{[^}]*useDiscoverStore[^}]*\}\s*from/m,
    'use-discover-store 不能再静态 import',
  );
  assert.doesNotMatch(
    session,
    /^import\s*\{[^}]*invalidateVipLevels[^}]*\}\s*from/m,
    'invalidateVipLevels 不能再静态 import',
  );
  // 改为惰性 loader
  assert.match(
    session,
    /await import\(\s*'@\/features\/discover\/store\/use-discover-store'\s*\)/,
  );
  assert.match(session, /await import\('@\/stores\/userVipStore'\)/);
  assert.match(session, /const useDiscoverStore = await loadDiscoverStore\(\)/);
  assert.match(
    session,
    /const invalidateVipLevels = await loadVipLevelsInvalidator\(\)/,
  );
});

// ---------------------------------------------------------------------------
// im/client.ts：换号即清上一账号的 OpenIM 本地库
// ---------------------------------------------------------------------------

test('OpenIM 本地聊天库在换号登录时被清除，同号重登保留 (#96)', () => {
  const client = read('src/im/client.ts');

  assert.match(client, /OPENIM_DATA_OWNER_KEY = 'circle-im-openim-data-owner'/);
  assert.match(client, /wipeStaleOpenIMDataOnAccountChange/);
  // round 2：owner 标记存哈希（含裸 id 兼容升级），不在 MMKV 留可读账号标识
  assert.match(client, /hashOwnerKey\(imUserID\)/);
  assert.match(client, /stored === hashed \|\| stored === imUserID/);
  // 同账号早退：不删库（哈希/裸 id 任一命中都算同号）
  assert.match(client, /if \(stored !== hashed\) storage\.set\(OPENIM_DATA_OWNER_KEY, hashed\)/);
  // round 2 P1：无主但目录已存在（升级安装）同样按陈旧数据清除
  assert.match(client, /staleDataPresent = dataDirExists/);
  // SDK 已初始化时不转移 owner 且中止登录（review 修复：带别人库继续登录即泄漏）
  assert.match(client, /staleDataPresent && initPromise/);
  // 真正的删除路径；unlink 前先 unInitSDK 释放句柄（review 修复）
  assert.match(client, /RNFS\.unlink\(dataDir\)/);
  const wipeBody = client.slice(
    client.indexOf('async function wipeStaleOpenIMDataOnAccountChange'),
    client.indexOf('function isOpenIMResourceNotLoadedError'),
  );
  const unInitAt = wipeBody.indexOf('OpenIMSDK.unInitSDK()');
  const unlinkAt = wipeBody.indexOf('RNFS.unlink(dataDir)');
  assert.ok(unInitAt >= 0 && unlinkAt >= 0 && unInitAt < unlinkAt,
    'unInitSDK must run before unlink');
  // 清理失败 → 返回 false（调用方中止登录，owner 不转移）
  assert.match(wipeBody, /kind: 'accountDataWipe' \}\);\s*return false;/);
  // round 2：unInitSDK 非良性失败（句柄可能仍被握着）也中止，绝不带伤 unlink
  assert.match(wipeBody, /isOpenIMResourceNotLoadedError\(uninitError\)/);
  assert.match(wipeBody, /if \(!benign\) \{[\s\S]*?return false;/);
  // 调用方：清库失败必须**抛错**（bootstrap/token-recovery 只对异常记
  // 回前台重试欠账；静默 false 会被当成功，IM 断连到重启）
  assert.match(client, /const wipeSafe = await wipeStaleOpenIMDataOnAccountChange/);
  assert.match(client, /throw new Error\('openim stale-data wipe failed; login aborted'\)/);
  // logout 被拒后必须 unInit 验证拆除，才轮到 finalizeIMTeardown 清单例
  const logoutBody = client.slice(
    client.indexOf('async function performLogoutFromOpenIM'),
    client.indexOf('export function logoutFromOpenIM'),
  );
  assert.match(logoutBody, /kind: 'logout' \}\);[\s\S]*OpenIMSDK\.unInitSDK\(\)/);

  // 时序：必须先于 ensureOpenIMInitialized（initSDK 前无句柄才安全）
  const loginBody = client.slice(
    client.indexOf('export async function loginToOpenIM'),
    client.indexOf('async function performLogoutFromOpenIM'),
  );
  const wipeAt = loginBody.indexOf('wipeStaleOpenIMDataOnAccountChange(imUserID)');
  const initAt = loginBody.indexOf('await ensureOpenIMInitialized()');
  assert.ok(wipeAt >= 0 && initAt >= 0 && wipeAt < initAt,
    'wipe must run before ensureOpenIMInitialized');
});
