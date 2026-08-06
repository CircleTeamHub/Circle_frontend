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

