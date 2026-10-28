const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { withObservabilityStubs } = require('./helpers/observability-stubs');
const { loadTsModule } = require('./helpers/load-ts-module');

/**
 * 圈子通知 store 的真身。recoverTabBadgeSnapshot 里的快照要过它的红点门控，
 * 桩一份形状的话门控语义就有了第二处实现。
 */
function loadCircleNotificationStore() {
  const backing = new Map();
  const shims = {
    zustand: require('zustand'),
    'zustand/middleware': require('zustand/middleware'),
    '@/storage': {
      mmkvJsonStorage: {
        getItem: (key) => backing.get(key) ?? null,
        setItem: (key, value) => backing.set(key, value),
        removeItem: (key) => backing.delete(key),
      },
    },
  };
  return loadTsModule(
    'src/features/discover/store/use-circle-notification-store.ts',
    {
      requireShim: (specifier) => {
        if (shims[specifier]) return shims[specifier];
        throw new Error(`unexpected import: ${specifier}`);
      },
    },
  );
}

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
    require: withObservabilityStubs((specifier) => {
      if(specifier === '@/features/profile/store-announcement-signal') return {useAnnouncementSignalStore:{getState:()=>({bump:()=>{}})}};
      if (specifier === '@/services/api/group-admissions') return { refreshGroupAdmissionUnread: async () => {} };
      if (specifier in mocks) return mocks[specifier];
      if (specifier === 'expo-crypto') return { randomUUID: () => '123e4567-e89b-42d3-a456-426614174000' };
      if (specifier.startsWith('@/')) return {};
      return require(specifier);
    }),
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function notification(id) {
  return {
    id,
    type: 'TRACE_COMMENT',
    content: id,
    read: false,
    createdAt: '2026-10-20T00:00:00.000Z',
  };
}

function loadRecoveryHarness({
  authState = {
    sessionEpoch: 1,
    user: { id: 'u1' },
    setUser() {},
  },
  initialBadge = 0,
  initialInteractive = [],
  fetchNotificationUnreadSummary,
  fetchNotifications,
}) {
  let interactive = initialInteractive;
  const badgeStore = {
    messagesUnread: 0,
    contactsUnread: 0,
    discoverUnread: initialBadge,
    momentsUnread: 0,
    circleUnread: 0,
    signupUnread: 0,
    profileUnread: 0,
    systemUnread: 0,
    applySnapshot(snapshot) {
      Object.assign(this, snapshot);
    },
  };
  const client = loadRealtimeClient({
    '@/constants/config': { REALTIME_WS_URL: 'ws://localhost/realtime' },
    '@/services/api/plaza': { fetchMySignupsUnreadCount: async () => 0 },
    '@/services/api/friends': { fetchUnreadFriendActivityCount: async () => 0 },
    '@/services/api/auth': { fetchCurrentUser: async () => ({ id: 'u1' }) },
    '@/services/api/notifications': {
      fetchNotificationUnreadSummary,
      fetchNotifications,
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
      useNotificationSnackbarStore: {
        getState: () => ({ enqueueNotification() {} }),
      },
    },
    '@/features/call/store/use-call-store': {
      useCallStore: { getState: () => ({}) },
    },
    '@/services/auth/session': { registerLogoutHandler() {} },
    '@/stores/authStore': {
      useAuthStore: { getState: () => authState },
    },
    '@/stores/tabBadgeStore': { useTabBadgeStore: { getState: () => badgeStore } },
    '@/stores/friendActivityUnreadStore': {
      useFriendActivityUnreadStore: {
        getState: () => ({
          setRealtimeCount(count) {
            badgeStore.contactsUnread = count;
          },
        }),
      },
    },
    '@/stores/walletRealtimeStore': {
      useWalletRealtimeStore: { getState: () => ({ setRealtimeBalance() {} }) },
    },
    '@/features/call/realtime-guards': {},
    '@/features/discover/store/use-circle-notification-store':
      loadCircleNotificationStore(),
  });

  return {
    badgeStore,
    client,
    getInteractive: () => interactive,
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
      useAuthStore: {
        getState: () => ({
          sessionEpoch: 1,
          user: { id: 'u1' },
          setUser() {},
        }),
      },
    },
    '@/stores/tabBadgeStore': { useTabBadgeStore: { getState: () => badgeStore } },
    '@/stores/friendActivityUnreadStore': {
      useFriendActivityUnreadStore: {
        getState: () => ({
          setRealtimeCount(count) {
            badgeStore.contactsUnread = count;
          },
        }),
      },
    },
    '@/stores/walletRealtimeStore': {
      useWalletRealtimeStore: { getState: () => ({ setRealtimeBalance() {} }) },
    },
    '@/features/call/realtime-guards': {},
    '@/features/discover/store/use-circle-notification-store':
      loadCircleNotificationStore(),
  });

  await client.recoverTabBadgeSnapshot();

  assert.equal(fetchedNotifications, 1);
  assert.equal(interactive.map((item) => item.id).join(','), 'missed,old');
  assert.equal(badgeStore.discoverUnread, 1);
});

test('newer forced recovery wins when an older request resolves last', async () => {
  const olderSummary = deferred();
  const newerSummary = deferred();
  const summaries = [olderSummary.promise, newerSummary.promise];
  const recoveredLists = [[notification('newer')], [notification('older')]];
  const harness = loadRecoveryHarness({
    initialInteractive: [notification('existing')],
    fetchNotificationUnreadSummary: () => summaries.shift(),
    fetchNotifications: async () => recoveredLists.shift(),
  });

  const olderRecovery = harness.client.recoverTabBadgeSnapshot({ force: true });
  const newerRecovery = harness.client.recoverTabBadgeSnapshot({ force: true });

  newerSummary.resolve({ discoverUnread: 2, profileUnread: 2 });
  await newerRecovery;
  olderSummary.resolve({ discoverUnread: 1, profileUnread: 1 });
  await olderRecovery;

  assert.equal(harness.badgeStore.discoverUnread, 2);
  assert.equal(
    harness.getInteractive().map((item) => item.id).join(','),
    'newer,existing',
  );
});

test('older notification backfill cannot overwrite a newer forced recovery', async () => {
  const olderList = deferred();
  const newerList = deferred();
  const olderListStarted = deferred();
  const newerListStarted = deferred();
  let summaryCalls = 0;
  let listCalls = 0;
  const harness = loadRecoveryHarness({
    initialInteractive: [notification('existing')],
    fetchNotificationUnreadSummary: async () => {
      summaryCalls += 1;
      return {
        discoverUnread: summaryCalls,
        profileUnread: summaryCalls,
      };
    },
    fetchNotifications: () => {
      listCalls += 1;
      if (listCalls === 1) {
        olderListStarted.resolve();
        return olderList.promise;
      }
      newerListStarted.resolve();
      return newerList.promise;
    },
  });

  const olderRecovery = harness.client.recoverTabBadgeSnapshot({ force: true });
  await olderListStarted.promise;
  const newerRecovery = harness.client.recoverTabBadgeSnapshot({ force: true });
  await newerListStarted.promise;
  newerList.resolve([notification('newer')]);
  await newerRecovery;
  olderList.resolve([notification('older')]);
  await olderRecovery;

  assert.equal(harness.badgeStore.discoverUnread, 2);
  assert.equal(
    harness.getInteractive().map((item) => item.id).join(','),
    'newer,existing',
  );
});

test('recovery from an old auth session cannot update the current account', async () => {
  const summary = deferred();
  const authState = {
    sessionEpoch: 7,
    user: { id: 'old-user' },
    setUser() {},
  };
  const harness = loadRecoveryHarness({
    authState,
    initialBadge: 9,
    initialInteractive: [notification('current')],
    fetchNotificationUnreadSummary: () => summary.promise,
    fetchNotifications: async () => [notification('old-account')],
  });

  const recovery = harness.client.recoverTabBadgeSnapshot({ force: true });
  authState.sessionEpoch = 8;
  authState.user = { id: 'new-user' };
  summary.resolve({ discoverUnread: 1, profileUnread: 1 });
  await recovery;

  assert.equal(harness.badgeStore.discoverUnread, 9);
  assert.equal(
    harness.getInteractive().map((item) => item.id).join(','),
    'current',
  );
});

test('a throttled recovery does not invalidate a valid in-flight request', async () => {
  const summary = deferred();
  const harness = loadRecoveryHarness({
    initialBadge: 0,
    initialInteractive: [],
    fetchNotificationUnreadSummary: () => summary.promise,
    fetchNotifications: async () => [notification('accepted')],
  });

  const inFlight = harness.client.recoverTabBadgeSnapshot();
  await harness.client.recoverTabBadgeSnapshot();
  summary.resolve({ discoverUnread: 4, profileUnread: 4 });
  await inFlight;

  assert.equal(harness.badgeStore.discoverUnread, 4);
  assert.equal(
    harness.getInteractive().map((item) => item.id).join(','),
    'accepted',
  );
});
