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
    // 纯判断模块零依赖，直接加载真身：桩出来的谓词语义会和线上漂移。
    '@/features/chat/utils/chat-background-uri': loadTsModule(
      'src/features/chat/utils/chat-background-uri.ts',
    ),
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
// 背景图本体：清偏好的每一条路径都要连带清磁盘
// ---------------------------------------------------------------------------

test('清偏好时按「当前仍被引用的」清背景图，而不是一刀切清空', async () => {
  const pruneCalls = [];
  const shims = {
    zustand: require('zustand'),
    'zustand/middleware': require('zustand/middleware'),
    '@/storage': mmkvShim(),
    '@/features/chat/utils/chat-background-uri': loadTsModule(
      'src/features/chat/utils/chat-background-uri.ts',
    ),
    '@/features/chat/utils/chat-background-image': {
      __esModule: true,
      pruneChatBackgroundImages: async (uris) => {
        pruneCalls.push([...uris]);
      },
    },
  };
  const { clearUnreferencedChatBackgroundImages, useChatPreferencesStore } =
    loadTsModule('src/features/chat/store/use-chat-preferences-store.ts', {
      requireShim: (specifier) => {
        if (shims[specifier]) return shims[specifier];
        throw new Error(`unexpected import: ${specifier}`);
      },
    });

  useChatPreferencesStore
    .getState()
    .setChatBackgroundPreference('conv-a', {
      mode: 'image',
      uri: 'chat-bg:bg-1-a.jpg',
    });

  // 登出被更新会话抢占时 session.ts 会跳过 resetForLogout 但照样 clearStorage()。
  // 那一支若无脑清空，会把新账号刚选的壁纸也删掉；按引用清才两边都对。
  await clearUnreferencedChatBackgroundImages();
  assert.deepEqual(pruneCalls, [['chat-bg:bg-1-a.jpg']]);

  useChatPreferencesStore.getState().resetForLogout();
  await new Promise((resolve) => setImmediate(resolve));
  // 偏好清空之后没有任何引用 —— 上一个账号的壁纸不能留在设备上。
  assert.deepEqual(pruneCalls[1], []);
});

// ---------------------------------------------------------------------------
// session.ts：显式清理清单接进 performClearLocalSession
// ---------------------------------------------------------------------------

test('登出清理清单点名每一个账号级持久化 store，幸存者留有名单 (#97)', () => {
  const session = read('src/services/auth/session.ts');

  assert.match(session, /ACCOUNT_SCOPED_STORE_LOADERS/);
  assert.match(session, /use-local-unread-store/);
  assert.match(session, /use-chat-preferences-store/);
  assert.match(session, /use-discover-filter-store/);
  assert.match(session, /use-circle-shortcut-order-store/);
  // 圈子通知三档从「设备偏好」改判成账号级：offlineEnabled 镜像的是
  // User.circleOfflinePushEnabled 这个 per-user 字段，留在设备上会让 B 继承
  // A 的关闭态，B 第一次拨动就把 A 派生的值 PUT 进自己的账号。
  assert.match(session, /use-circle-notification-store/);
  assert.doesNotMatch(
    session,
    /circle-im-circle-notification.*—— 只有/,
    '它不再是幸存者，旧的「无账号数据」理由必须一起删掉',
  );
  // 幸存者是显式决定，不是遗漏
  assert.match(session, /circle-im-app-settings/);
  assert.match(session, /circle-im-notification-feedback/);
  // 清单在 performClearLocalSession 里被消费：先重置内存再删持久化
  assert.match(
    session,
    /await clearAccountScopedPersistedStores\(clearedSessionEpoch\)/,
  );
  assert.match(session, /resetForLogout\(\)/);
  assert.match(session, /clearStorage\?\.\(\)/);
});

test('磁盘足迹与 clearStorage 同档，不受 sessionEpoch 守卫影响 (#235 review)', () => {
  const session = read('src/services/auth/session.ts');
  const loop = session.slice(
    session.indexOf('for (const load of ACCOUNT_SCOPED_STORE_LOADERS)'),
    session.indexOf("reportHandledFailure('session', 'accountScopedStoreClear'"),
  );
  assert.ok(loop, '找不到 clearAccountScopedPersistedStores 的循环体');

  const guarded =
    /if \(useAuthStore\.getState\(\)\.sessionEpoch === clearedSessionEpoch\) \{([\s\S]*?)\n      \}/.exec(
      loop,
    );
  assert.ok(guarded, '找不到 sessionEpoch 守卫');
  // 内存重置会擦掉抢跑的新会话状态，所以它必须留在守卫里。
  assert.match(guarded[1], /resetForLogout\(\)/);
  // 磁盘上的壁纸是**刚登出账号**的足迹：跳过它 = 引用先没了、文件永远留着。
  assert.doesNotMatch(guarded[1], /clearDeviceArtifacts/);
  assert.match(loop, /clearDeviceArtifacts\?\.\(\)/);
  assert.match(session, /clearDeviceArtifacts: clearUnreferencedChatBackgroundImages/);
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

