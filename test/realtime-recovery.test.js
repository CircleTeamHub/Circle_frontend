const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadRealtimeClient(mocks) {
  const filePath = path.join(process.cwd(), 'src/realtime/client.ts');
  const source = fs.readFileSync(filePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      baseUrl: process.cwd(),
      paths: { '@/*': ['src/*'] },
    },
    fileName: filePath,
  }).outputText;
  const context = {
    module: { exports: {} },
    exports: {},
    console,
    Date,
    WebSocket: function WebSocket() {},
    setTimeout,
    clearTimeout,
    require: (specifier) => {
      if (specifier in mocks) return mocks[specifier];
      if (specifier.startsWith('@/')) return {};
      return require(specifier);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

function makeStore(initial) {
  let state = { ...initial };
  return {
    getState: () => state,
    setState: (next) => {
      state = { ...state, ...next };
    },
  };
}

test('realtime recovery backfills missed interactive notifications after reconnect', async () => {
  const existing = {
    id: 'old',
    type: 'TRACE_COMMENT',
    content: 'old',
    read: false,
    createdAt: '2026-07-11T00:00:00.000Z',
  };
  const missed = {
    id: 'missed',
    type: 'TRACE_MENTION',
    content: 'missed while offline',
    read: false,
    createdAt: '2026-07-11T00:01:00.000Z',
  };
  let interactive = [existing];
  const badgeStore = {
    messagesUnread: 0,
    contactsUnread: 0,
    discoverUnread: 0,
    signupUnread: 0,
    profileUnread: 0,
    systemUnread: 0,
    applySnapshot(snapshot) {
      Object.assign(this, snapshot);
    },
  };
  let fetchedNotifications = 0;
  const client = loadRealtimeClient({
    '@/constants/config': { REALTIME_WS_URL: 'ws://localhost/realtime' },
    '@/services/api/plaza': { fetchMySignupsUnreadCount: async () => 0 },
    '@/services/api/friends': { fetchUnreadFriendActivityCount: async () => 0 },
    '@/services/api/auth': { fetchCurrentUser: async () => ({ id: 'u1' }) },
    '@/services/api/notifications': {
      fetchNotificationUnreadSummary: async () => ({
        discoverUnread: 1,
        profileUnread: 0,
        totalUnread: 1,
      }),
      fetchNotifications: async (page) => {
        fetchedNotifications += 1;
        assert.equal(page, 1);
        return [missed, existing];
      },
    },
    '@/features/notifications/store/use-notification-center-store': {
      useNotificationCenterStore: {
        getState: () => ({
          interactive,
          setInteractive(items) {
            interactive = items;
          },
        }),
      },
    },
    '@/features/notifications/store/use-notification-snackbar-store': {
      useNotificationSnackbarStore: { getState: () => ({ enqueueNotification() {} }) },
    },
    '@/features/call/store/use-call-store': {
      useCallStore: { getState: () => ({}) },
    },
    '@/services/auth/session': { registerLogoutHandler() {} },
    '@/stores/authStore': {
      useAuthStore: { getState: () => ({ setUser() {} }) },
    },
    '@/stores/tabBadgeStore': { useTabBadgeStore: { getState: () => badgeStore } },
    '@/stores/walletRealtimeStore': {
      useWalletRealtimeStore: { getState: () => ({ setRealtimeBalance() {} }) },
    },
    '@/features/call/realtime-guards': {},
  });

  await client.recoverTabBadgeSnapshot();

  assert.equal(fetchedNotifications, 1);
  assert.equal(interactive.map((item) => item.id).join(','), 'missed,old');
  assert.equal(badgeStore.discoverUnread, 1);
});
