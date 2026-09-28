const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { withObservabilityStubs } = require('./helpers/observability-stubs');
const { withChatCoreStubs } = require('./helpers/chat-core-stubs');

const __localDbStub = {
  persistLocalConversations: async () => {},
  upsertLocalConversation: async () => {},
  removeLocalConversation: async () => {},
  persistLocalMessages: async () => {},
  deleteLocalMessage: async () => {},
  clearLocalConversationMessages: async () => {},
  deleteLocalMessagesBelow: async () => {},
  readRecentLocalMessages: async () => [],
  readLocalConversations: async () => [],
  searchLocalChatMessages: async () => [],
  outboxUpsert: async () => {},
  outboxDelete: async () => {},
  outboxList: async () => [],
  pendingReadUpsert: async () => {},
  pendingReadDelete: async () => {},
  pendingReadsList: async () => [],
  initChatLocalDb: async () => false,
  wipeChatLocalDb: async () => {},
};


function transpile(rel) {
  const filePath = path.join(process.cwd(), rel);
  const source = fs.readFileSync(filePath, 'utf8');
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;
}

function runModule(rel, stubs, globals = {}) {
  const context = {
    console: { warn: () => {}, error: () => {} },
    setTimeout,
    clearTimeout,
    Date,
    Math,
    JSON,
    Promise,
    ...globals,
    module: { exports: {} },
    exports: {},
    require: withObservabilityStubs(
      withChatCoreStubs((request) => {
        if (request in stubs) return stubs[request];
        if (request === './local-db') return __localDbStub;
        throw new Error(`unexpected require: ${request}`);
      }),
    ),
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpile(rel), context);
  return context.module.exports;
}

// 极简 socket 桩:记录 emit,允许测试用例注入 ack 响应。
function fakeSocketFactory() {
  const captured = { url: null, opts: null };
  const socket = {
    connected: false,
    // socket.io:传输层失败时 active 仍为 true(自己会重连);握手被服务端拒、
    // 或被服务端断开之后是 false,只有再调一次 connect() 才会重连。
    active: true,
    connectCalls: 0,
    handlers: new Map(),
    emitted: [],
    ackResponder: null,
    on(event, handler) {
      this.handlers.set(event, handler);
      return this;
    },
    timeout() {
      return {
        emit: (event, payload, cb) => {
          socket.emitted.push({ event, payload });
          if (socket.ackResponder) socket.ackResponder(event, payload, cb);
        },
      };
    },
    emit(event, payload) {
      this.emitted.push({ event, payload });
    },
    removeAllListeners() {
      this.handlers.clear();
    },
    disconnect() {
      this.connected = false;
    },
    connect() {
      this.connectCalls += 1;
      this.active = true;
      return this;
    },
    fire(event, ...args) {
      const handler = this.handlers.get(event);
      if (handler) handler(...args);
    },
  };
  const io = (url, opts) => {
    captured.url = url;
    captured.opts = opts;
    return socket;
  };
  return { io, socket, captured };
}

// 手动推进的定时器:按延迟挑着跑,测退避节奏不用真等。
function createFakeTimers() {
  let nextId = 1;
  const pending = new Map();
  return {
    setTimeout: (fn, ms) => {
      const id = nextId;
      nextId += 1;
      pending.set(id, { fn, ms });
      return id;
    },
    clearTimeout: (id) => {
      pending.delete(id);
    },
    delays: () => [...pending.values()].map((timer) => timer.ms),
    run(ms) {
      for (const [id, timer] of [...pending.entries()]) {
        if (timer.ms !== ms) continue;
        pending.delete(id);
        timer.fn();
      }
    },
  };
}

// socket.io 每次握手(包括自动重连)都会取一次 auth:回调形式现取,对象形式原样重发。
// 这里按客户端的做法取出「这一次握手」实际带上的内容。
function handshakeAuth(captured) {
  const { auth } = captured.opts;
  if (typeof auth !== 'function') return auth;
  let payload = null;
  auth((data) => {
    payload = data;
  });
  return payload;
}

function loadManager(localDbOverrides = {}, options = {}) {
  const { io, socket, captured } = fakeSocketFactory();
  const dismissedNotifications = [];
  const reports = [];
  const diagnostics = [];
  const storeModule = (() => {
    const state = {
      connected: false,
      connecting: false,
      currentUserId: null,
      calls: [],
      setConnected(v) {
        state.connected = v;
        state.calls.push(['setConnected', v]);
      },
      setConnecting(v) {
        state.connecting = v;
        state.calls.push(['setConnecting', v]);
      },
      setCurrentUserId(v) {
        state.currentUserId = v;
      },
      viewerSelfDestructSec: 0,
      viewerSelfDestructPolicyRevision: 0,
      setViewerSelfDestructSec(v, writeOptions) {
        state.viewerSelfDestructSec = v;
        if (!writeOptions?.remoteRefresh) {
          state.viewerSelfDestructPolicyRevision += 1;
        }
        state.calls.push(['setViewerSelfDestructSec', v]);
        if (state.currentUserId) {
          mmkvStore.set(
            `chat.viewerSelfDestructSec.${state.currentUserId}`,
            String(v),
          );
        }
      },
      onlineByUser: {},
      lastSeenByUser: {},
      applyPresence(userId, online, lastSeenAt) {
        state.onlineByUser[userId] = online;
        state.lastSeenByUser[userId] = online
          ? null
          : lastSeenAt === undefined
            ? (state.lastSeenByUser[userId] ?? null)
            : lastSeenAt;
      },
      clearPresence(userId) {
        delete state.onlineByUser[userId];
        delete state.lastSeenByUser[userId];
      },
      viewerTypingPolicy: { direct: true, group: true },
      setViewerTypingPolicy(policy) {
        state.viewerTypingPolicy = policy;
        state.calls.push(['setViewerTypingPolicy', policy]);
        if (state.currentUserId) {
          mmkvStore.set(
            `chat.viewerTypingPolicy.${state.currentUserId}`,
            JSON.stringify(policy),
          );
        }
      },
      setError(v) {
        state.error = v;
      },
      purgeExpiredBurnMessages: async () => {},
      appForeground: true,
      setAppForeground(v) {
        state.appForeground = v;
      },
      reset() {
        state.calls.push(['reset']);
        state.connected = false;
        state.currentUserId = null;
      },
      activeConversationId: null,
      conversations: [],
      messagesByConversation: {},
      // 冷启动水合会用到这三个;默认 initChatLocalDb=false 时根本走不到,
      // 只有显式打开本地库的用例才会触发。
      hydrated: [],
      failedMarks: [],
      hydrateLocalSnapshot(conversations, timelines) {
        state.hydrated.push({ conversations, timelines });
        if (state.conversations.length === 0) state.conversations = conversations;
        state.messagesByConversation = { ...timelines };
      },
      ingestMessages(conversationId, messages) {
        const existing = state.messagesByConversation[conversationId] ?? [];
        // 只保留被断言用到的语义:同 d 覆盖(与 mergeMessages 一致)。
        const kept = existing.filter(
          (m) => !messages.some((incoming) => incoming.d && incoming.d === m.d),
        );
        state.messagesByConversation[conversationId] = [...kept, ...messages];
      },
      markMessageFailed(conversationId, d) {
        state.failedMarks.push({ conversationId, d });
      },
    };
    return {
      useChatStore: { getState: () => state },
      sanitizeExpiredConversationPreviews: (conversations, viewerSeconds, now = Date.now()) =>
        conversations.map((conversation) => {
          const seconds = viewerSeconds > 0 ? viewerSeconds : null;
          const createdAt = Date.parse(conversation.lastMessage?.createdAt ?? '');
          return seconds && Number.isFinite(createdAt) && createdAt < now - seconds * 1000
            ? { ...conversation, lastMessage: null, lastMessageAt: null, unreadCount: 0 }
            : conversation;
        }),
      viewerSelfDestructSecStorageKey: (userId) =>
        `chat.viewerSelfDestructSec.${userId}`,
      readViewerTypingPolicy: (userId) => {
        const raw = mmkvStore.get(`chat.viewerTypingPolicy.${userId}`);
        return raw ? JSON.parse(raw) : { direct: true, group: true };
      },
      viewerTypingPolicyFromPrivacy: (settings) => ({
        direct: settings.shareTypingInDirect !== false,
        group: settings.shareTypingInGroup !== false,
      }),
      state,
    };
  })();
  const bound = [];
  const registeredTokenListeners = [];
  // 重连对账(G-13)的观测点:列表刷新次数、交给同步协调器的快照、token 刷新。
  const apiCalls = {
    conversations: 0,
    conversationSnapshot: [],
    snapshotSyncs: [],
    syncStarts: [],
    syncResets: 0,
    tokenRefreshes: 0,
    pendingMediaPrunes: [],
    initialHistory: [],
    privacyFetches: 0,
    privacyResponse: { messageSelfDestructSec: 2 * 24 * 60 * 60 },
  };
  const mmkvStore = new Map();
  const mmkv = {
    getString: (key) => mmkvStore.get(key),
    set: (key, value) => mmkvStore.set(key, String(value)),
    remove: (key) => mmkvStore.delete(key),
  };
  const protocol = runModule('src/chat-core/protocol.ts', {});
  const clock = { now: Date.now() };
  class FakeDate extends Date {
    static now() {
      return clock.now;
    }
  }
  const globals = {
    ...(options.timers
      ? {
          setTimeout: options.timers.setTimeout,
          clearTimeout: options.timers.clearTimeout,
        }
      : {}),
    ...(options.fakeClock ? { Date: FakeDate } : {}),
    ...(options.random
      ? { Math: Object.assign(Object.create(Math), { random: options.random }) }
      : {}),
  };
  const manager = runModule('src/chat-core/socket-manager.ts', {
    'socket.io-client': { io },
    'expo-crypto': {
      randomUUID: () => '123e4567-e89b-42d3-a456-426614174000',
    },
    '@/constants/config': { CHAT_WS_URL: 'http://api.test' },
    'react-native': {
      Platform: { OS: 'android' },
      AppState: { currentState: options.appState ?? 'active' },
    },
    './sync': {
      setConversationCacheResetHandler: () => {},
      startChatSync: (userId) => apiCalls.syncStarts.push(userId),
      resetChatSync: () => {
        apiCalls.syncResets += 1;
      },
      syncConversationsFromSnapshot: async (conversations, syncOptions) => {
        apiCalls.snapshotSyncs.push({
          conversations: [...conversations],
          prioritize: syncOptions?.prioritize ?? null,
        });
      },
      noteLiveRevision: () => {},
    },
    '@/services/api/client': {
      isDefinitiveAuthFailure: (error) => error?.definitive === true,
      refreshSessionAccessToken: () => {
        apiCalls.tokenRefreshes += 1;
        return options.refreshToken
          ? options.refreshToken()
          : Promise.resolve('fresh-token');
      },
    },
    // 真的 JWT 解析另有单测(jwt-expiry.test);这里只需要一个能指名「已过期」的 token。
    '@/utils/jwt-expiry': {
      isJwtExpired: (token) => token === 'expired-jwt',
    },
    './pending-media': {
      resolvePendingMediaUri: async (userId, d, fileName) =>
        options.pendingMediaUris?.[d] ?? null,
      prunePendingMedia: async (userId, referenced) => {
        apiCalls.pendingMediaPrunes.push([...referenced]);
      },
    },
    '@/utils/client-diagnostics': {
      logClientDiagnostic: (event, details) =>
        diagnostics.push({ event, details }),
    },
    '@/services/api/privacy': {
      fetchPrivacySettings: () => {
        apiCalls.privacyFetches += 1;
        return options.privacyFetch
          ? options.privacyFetch()
          : Promise.resolve(apiCalls.privacyResponse);
      },
    },
    './api': {
      loadChatConversations: () => {
        apiCalls.conversations += 1;
        return Promise.resolve(apiCalls.conversationSnapshot);
      },
      loadChatHistory: (conversationId) => {
        apiCalls.initialHistory.push(conversationId);
        return Promise.resolve({ messages: [], nextBeforeHeight: null });
      },
    },
    './local-db': {
      persistLocalConversations: async () => {},
      upsertLocalConversation: async () => {},
      removeLocalConversation: async () => {},
      persistLocalMessages: async () => {},
      deleteLocalMessage: async () => {},
      clearLocalConversationMessages: async () => {},
      deleteLocalMessagesBelow: async () => {},
      readRecentLocalMessages: async () => [],
      readLocalConversations: async () => [],
      outboxUpsert: async () => {},
      outboxDelete: async () => {},
      outboxList: async () => [],
      // 水合读的是这一个(读失败返回 null,不清待发媒体副本);用例大多只覆盖
      // outboxList,这里跟着它走。
      readOutboxEntries: async () =>
        localDbOverrides.outboxList ? localDbOverrides.outboxList() : [],
      pendingReadUpsert: async () => {},
      pendingReadDelete: async () => {},
      pendingReadsList: async () => [],
      initChatLocalDb: async () => false,
      ...localDbOverrides,
    },
    './app-badge': { initChatAppBadgeSync: () => {} },
    './chat-notifications': {
      dismissChatNotifications: (conversationId, messageIds) =>
        dismissedNotifications.push({ conversationId, messageIds }),
    },
    '@/features/notifications/services/push-token-registration': {
      getRegisteredPushToken: (userId) =>
        typeof options.pushToken === 'function'
          ? options.pushToken(userId)
          : (options.pushToken ?? null),
      subscribeRegisteredPushToken: (listener) => {
        registeredTokenListeners.push(listener);
        return () => {};
      },
    },
    // 视角自毁/输入状态策略按账号缓存在 MMKV;测试里用一个内存替身。
    '@/storage': { storage: mmkv },
    './dispatcher': {
      bindChatEvents: (sock, isLive) => bound.push({ sock, isLive }),
      cancelConversationBackfill: () => {},
    },
    './protocol': protocol,
    './store': storeModule,
    '@/observability/sentry': {
      reportError: (error, context) => reports.push({ error, context }),
    },
    // 队列逻辑零依赖,跑真的;定时器跟着用例注入的走。
    './send-queue': runModule('src/chat-core/send-queue.ts', {}, globals),
  }, globals);
  return {
    manager,
    socket,
    captured,
    clock,
    announceRegisteredPushToken: (registration) => {
      for (const listener of registeredTokenListeners) listener(registration);
    },
    store: storeModule.state,
    bound,
    apiCalls,
    reports,
    diagnostics,
    mmkvStore,
    dismissedNotifications,
  };
}

test('reading a conversation on this device clears its notifications', () => {
  const { manager, store, dismissedNotifications } = loadManager();
  store.markConversationReadLocal = () => {};
  manager.markConversationRead('c1', 7);
  assert.deepEqual(
    dismissedNotifications.map((entry) => ({ ...entry })),
    [{ conversationId: 'c1', messageIds: undefined }],
  );
});

test('viewer self-destruct uses the cached policy offline and refreshes it after connect', async () => {
  const { manager, socket, store, apiCalls, mmkvStore } = loadManager();
  mmkvStore.set('chat.viewerSelfDestructSec.u1', String(7 * 24 * 60 * 60));

  manager.connectChat('jwt', 'u1');
  assert.equal(store.viewerSelfDestructSec, 7 * 24 * 60 * 60);

  socket.fire('connect');
  for (let i = 0; i < 4; i += 1) await Promise.resolve();

  assert.equal(apiCalls.privacyFetches, 1);
  assert.equal(store.viewerSelfDestructSec, 2 * 24 * 60 * 60);
  assert.equal(mmkvStore.get('chat.viewerSelfDestructSec.u1'), String(2 * 24 * 60 * 60));
});

test('viewer self-destruct migrates the legacy day cache before an offline start', async () => {
  const { manager, store, mmkvStore } = loadManager(
    {},
    { privacyFetch: () => Promise.reject(new Error('offline')) },
  );
  mmkvStore.set('chat.viewerSelfDestructDays.u1', '7');

  manager.connectChat('jwt', 'u1');
  await flush();

  assert.equal(store.viewerSelfDestructSec, 7 * 24 * 60 * 60);
  assert.equal(mmkvStore.get('chat.viewerSelfDestructSec.u1'), String(7 * 24 * 60 * 60));
  // 一次性迁移要真的只跑一次：旧键必须删掉，否则每次离线启动都再查一遍。
  assert.equal(mmkvStore.has('chat.viewerSelfDestructDays.u1'), false);
});

test('legacy migration retires the old key even when the value is unusable', async () => {
  const { manager, store, mmkvStore } = loadManager(
    {},
    { privacyFetch: () => Promise.reject(new Error('offline')) },
  );
  // 旧值不在 {0,1,2,7,30} 白名单里（脏写 / 手改）——换算不出来也要收口，
  // 否则新键一直不写、旧键一直留着，每次冷启动都走同一条死路。
  mmkvStore.set('chat.viewerSelfDestructDays.u1', '13');

  manager.connectChat('jwt', 'u1');
  await flush();

  assert.equal(store.viewerSelfDestructSec, 0);
  assert.equal(mmkvStore.get('chat.viewerSelfDestructSec.u1'), '0');
  assert.equal(mmkvStore.has('chat.viewerSelfDestructDays.u1'), false);
});

test('fresh install has no legacy key and stays at the 0 default', async () => {
  const { manager, store, mmkvStore } = loadManager(
    {},
    { privacyFetch: () => Promise.reject(new Error('offline')) },
  );

  manager.connectChat('jwt', 'u1');
  await flush();

  assert.equal(store.viewerSelfDestructSec, 0);
  // 新装机没有旧键可查，迁移分支整条不该被走到。
  assert.equal(mmkvStore.has('chat.viewerSelfDestructDays.u1'), false);
});

test('the new key wins outright; a stale legacy key is never consulted', async () => {
  const { manager, store, mmkvStore } = loadManager(
    {},
    { privacyFetch: () => Promise.reject(new Error('offline')) },
  );
  mmkvStore.set('chat.viewerSelfDestructSec.u1', String(2 * 24 * 60 * 60));
  mmkvStore.set('chat.viewerSelfDestructDays.u1', '30');

  manager.connectChat('jwt', 'u1');
  await flush();

  assert.equal(store.viewerSelfDestructSec, 2 * 24 * 60 * 60);
});

test('cold hydration waits for the authoritative self-destruct policy', async () => {
  let resolvePolicy;
  const policy = new Promise((resolve) => {
    resolvePolicy = resolve;
  });
  const { manager, socket, store, apiCalls } = loadManager(
    {
      initChatLocalDb: async () => true,
      readLocalConversations: async () => [{ id: 'c1' }],
    },
    { privacyFetch: () => policy },
  );

  manager.connectChat('jwt', 'u1');
  socket.fire('connect');
  await flush();

  assert.equal(apiCalls.privacyFetches, 1);
  assert.equal(store.hydrated.length, 0);

  resolvePolicy({ messageSelfDestructSec: 2 * 24 * 60 * 60 });
  await flush();
  await flush();

  assert.equal(store.viewerSelfDestructSec, 2 * 24 * 60 * 60);
  assert.ok(store.hydrated.length > 0);
});

test('account switch starts the local database switch before privacy resolves', async () => {
  let resolvePolicy;
  const policy = new Promise((resolve) => {
    resolvePolicy = resolve;
  });
  const openedFor = [];
  const { manager, store } = loadManager(
    {
      initChatLocalDb: async (userId) => {
        openedFor.push(userId);
        return true;
      },
    },
    { privacyFetch: () => policy },
  );
  store.currentUserId = 'account-a';

  manager.connectChat('jwt-b', 'account-b');
  await Promise.resolve();

  assert.deepEqual(openedFor, ['account-b']);
  resolvePolicy({ messageSelfDestructSec: 2 * 24 * 60 * 60 });
  await flush();
});

test('cold hydration never publishes an expired local conversation preview', async () => {
  let releaseTimeline;
  const timelineGate = new Promise((resolve) => {
    releaseTimeline = resolve;
  });
  const expiredPreview = {
    id: 'expired',
    conversationId: 'c1',
    createdAt: '2026-08-01T00:00:00.000Z',
  };
  const { manager, socket, store } = loadManager({
    initChatLocalDb: async () => true,
    readLocalConversations: async () => [{
      id: 'c1',
      burnDurationSec: null,
      lastMessage: expiredPreview,
      lastMessageAt: expiredPreview.createdAt,
      unreadCount: 4,
    }],
    readRecentLocalMessages: async () => {
      await timelineGate;
      return [];
    },
  });

  manager.connectChat('jwt', 'u1');
  socket.fire('connect');
  await flush();
  await flush();

  assert.equal(store.hydrated.length, 1);
  assert.equal(store.hydrated[0].conversations[0].lastMessage, null);
  assert.equal(store.hydrated[0].conversations[0].unreadCount, 0);

  releaseTimeline();
});

test('cold hydration rejects expired outbox content even when durable purge did not delete it', async () => {
  const deleted = [];
  const expiredAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const { manager, store } = loadManager({
    initChatLocalDb: async () => true,
    readLocalConversations: async () => [{ id: 'c1', burnDurationSec: null }],
    readRecentLocalMessages: async () => [],
    outboxList: async () => [
      {
        d: 'expired-private',
        conversationId: 'c1',
        payload: {
          conversationId: 'c1',
          type: 'text',
          content: { text: 'private body' },
          d: 'expired-private',
        },
        createdAt: expiredAt,
      },
    ],
    outboxDelete: async (d) => {
      deleted.push(d);
    },
  });

  manager.connectChat('jwt', 'u1');
  await flush();
  await flush();

  assert.deepEqual(store.failedMarks, []);
  assert.deepEqual(deleted, ['expired-private']);
});

test('outbox fallback uses the current post-purge conversation policy', async () => {
  let releasePurge;
  const purgeGate = new Promise((resolve) => {
    releasePurge = resolve;
  });
  const deleted = [];
  const createdAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { manager, store } = loadManager({
    initChatLocalDb: async () => true,
    readLocalConversations: async () => [{ id: 'c1', burnDurationSec: null }],
    readRecentLocalMessages: async () => [],
    outboxList: async () => [
      {
        d: 'expired-by-current-policy',
        conversationId: 'c1',
        payload: { conversationId: 'c1', type: 'text', content: {}, d: 'expired-by-current-policy' },
        createdAt,
      },
    ],
    outboxDelete: async (d) => {
      deleted.push(d);
    },
  });
  store.purgeExpiredBurnMessages = async () => purgeGate;

  manager.connectChat('jwt', 'u1');
  await flush();
  store.conversations = [{ id: 'c1', burnDurationSec: 60 * 60 }];
  releasePurge();
  await flush();

  assert.deepEqual(store.failedMarks, []);
  assert.deepEqual(deleted, ['expired-by-current-policy']);
});

test('outbox fallback observes a policy tightened while the outbox is loading', async () => {
  let resolveOutbox;
  const outboxGate = new Promise((resolve) => {
    resolveOutbox = resolve;
  });
  const deleted = [];
  const createdAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { manager, store } = loadManager({
    initChatLocalDb: async () => true,
    readLocalConversations: async () => [{ id: 'c1', burnDurationSec: null }],
    readRecentLocalMessages: async () => [],
    outboxList: async () => outboxGate,
    outboxDelete: async (d) => {
      deleted.push(d);
    },
  });

  manager.connectChat('jwt', 'u1');
  await flush();
  await flush();
  store.conversations = [{ id: 'c1', burnDurationSec: 60 * 60 }];
  resolveOutbox([
    {
      d: 'expired-during-outbox-read',
      conversationId: 'c1',
      payload: { conversationId: 'c1', type: 'text', content: {}, d: 'expired-during-outbox-read' },
      createdAt,
    },
  ]);
  await flush();

  assert.deepEqual(store.failedMarks, []);
  assert.deepEqual(deleted, ['expired-during-outbox-read']);
});

test('a stale outbox read cannot mutate the store after an A-B-A switch', async () => {
  let resolveFirstOutbox;
  const firstOutbox = new Promise((resolve) => {
    resolveFirstOutbox = resolve;
  });
  let outboxCalls = 0;
  const { manager, store } = loadManager({
    initChatLocalDb: async () => true,
    readLocalConversations: async () => [{ id: 'c1', burnDurationSec: null }],
    readRecentLocalMessages: async () => [],
    outboxList: async () => {
      outboxCalls += 1;
      return outboxCalls === 1 ? firstOutbox : [];
    },
  });

  manager.connectChat('jwt-a1', 'account-a');
  await flush();
  await flush();
  manager.connectChat('jwt-b', 'account-b');
  manager.connectChat('jwt-a2', 'account-a');
  resolveFirstOutbox([
    {
      d: 'stale-a',
      conversationId: 'c1',
      payload: { conversationId: 'c1', type: 'text', content: {}, d: 'stale-a' },
      createdAt: new Date().toISOString(),
    },
  ]);
  await flush();
  await flush();

  assert.ok(!store.failedMarks.some((mark) => mark.d === 'stale-a'));
});

test('a stale policy refresh cannot overwrite a newer local setting', async () => {
  let resolvePolicy;
  const policy = new Promise((resolve) => {
    resolvePolicy = resolve;
  });
  const { manager, socket, store } = loadManager({}, { privacyFetch: () => policy });

  manager.connectChat('jwt', 'u1');
  socket.fire('connect');
  store.setViewerSelfDestructSec(7 * 24 * 60 * 60);
  resolvePolicy({ messageSelfDestructSec: 2 * 24 * 60 * 60 });
  await flush();

  assert.equal(store.viewerSelfDestructSec, 7 * 24 * 60 * 60);
});

test('first connect and every reconnect resync conversations through the revision stream', async () => {
  const { manager, socket, store, apiCalls } = loadManager();
  apiCalls.conversationSnapshot = [{ id: 'c1', syncRevision: 12 }];
  manager.connectChat('jwt', 'u1');
  assert.deepEqual(apiCalls.syncStarts, ['u1']);
  socket.fire('connect');
  await flush();
  // 首连也要对账:上次退出到这次启动之间的新消息、撤回、回应本地一条都没有。
  // 消息页可能在 socket 已连接后才挂载,也靠这一次把列表拉到。
  assert.equal(apiCalls.conversations, 1);
  assert.equal(apiCalls.snapshotSyncs.length, 1);
  assert.deepEqual(
    apiCalls.snapshotSyncs[0].conversations.map((c) => c.id),
    ['c1'],
  );
  assert.equal(apiCalls.snapshotSyncs[0].prioritize, null);

  socket.fire('disconnect');
  store.activeConversationId = 'c1';
  store.messagesByConversation = { c1: [{ height: 4 }, { height: 9 }] };
  socket.fire('connect');
  await flush();
  // 重连:同一趟同步追平新消息与撤回/编辑/回应(不再有按 height 的补拉和
  // 按时间戳的撤回通道),正开着的会话排最前。
  assert.equal(apiCalls.conversations, 2);
  assert.equal(apiCalls.snapshotSyncs[1].prioritize, 'c1');
  // 时间线里有确认过的消息:不必重拉首屏。
  assert.deepEqual(apiCalls.initialHistory, []);
});

test('logging out resets the sync coordinator; a new login starts it again', () => {
  const { manager, apiCalls } = loadManager();
  manager.connectChat('jwt', 'u1');
  manager.disconnectChat();
  assert.equal(apiCalls.syncResets, 1);
  manager.connectChat('jwt', 'u2');
  assert.deepEqual(apiCalls.syncStarts, ['u1', 'u2']);
});

test('token rotation (suspend + reconnect) still counts as a reconnect', async () => {
  const { manager, socket, store, apiCalls } = loadManager();
  manager.connectChat('jwt', 'u1');
  socket.fire('connect');
  await flush();
  assert.equal(apiCalls.conversations, 1);

  // access token 轮换走的是 suspendChat + connectChat:换的是一条**新 socket**。
  // 判据挂在 socket 上的话这条新连接永远算首连,断开窗口里的消息一条都不补。
  manager.suspendChat();
  store.activeConversationId = 'c1';
  store.messagesByConversation = { c1: [] };
  manager.connectChat('jwt-rotated', 'u1');
  socket.fire('connect');
  await flush();

  assert.equal(apiCalls.conversations, 2);
  assert.equal(apiCalls.snapshotSyncs[1].prioritize, 'c1');
  // 只有重连才会给空时间线补首屏:这一条证明轮换被认成了重连。
  assert.deepEqual(apiCalls.initialHistory, ['c1']);
});

test('reconnect with an empty active timeline loads the first history page', async () => {
  const { manager, socket, store, apiCalls } = loadManager();
  manager.connectChat('jwt', 'u1');
  socket.fire('connect');
  socket.fire('disconnect');
  // 打开会话时正好断网、首屏 REST 也失败 —— 一条确认消息都没有。
  // 同步协调器眼里这是「没有本地缓存」的会话,只采纳位置、不拉内容。
  store.activeConversationId = 'c1';
  store.messagesByConversation = { c1: [{ height: 0 }] };
  socket.fire('connect');
  await flush();

  assert.deepEqual(apiCalls.initialHistory, ['c1']);
});

test('an access token that has already expired is refreshed instead of handshaking', () => {
  const { manager, captured, store, apiCalls } = loadManager();
  manager.connectChat('expired-jwt', 'u1');

  // 拿过期 token 握手只会被拒,而被拒的握手 socket.io 不会自己重连。
  assert.equal(captured.url, null);
  assert.equal(apiCalls.tokenRefreshes, 1);
  assert.equal(store.connecting, false);
  // 本地水合与账号身份照常建立:离线时列表和历史仍然能看。
  assert.equal(store.currentUserId, 'u1');
});

test('a server-announced token expiry refreshes the token after the disconnect', () => {
  const timers = createFakeTimers();
  const { manager, socket, apiCalls } = loadManager({}, {
    timers,
    random: () => 0.5,
  });
  manager.connectChat('jwt', 'u1');
  socket.fire('connect');

  // 没说原因的服务端断开(进房失败、连接数超限、会话被吊销):不刷新 token,
  // 按退避重连 —— 被吊销的话,重连时的握手会被拒,那里再去刷新。
  socket.fire('disconnect', 'io server disconnect');
  assert.equal(apiCalls.tokenRefreshes, 0);
  assert.deepEqual(timers.delays(), [2_000]);
  timers.run(2_000);
  assert.equal(socket.connectCalls, 1);

  socket.fire('connect');
  socket.fire('chat:session_expired', { reason: 'token_expired' });
  socket.fire('disconnect', 'io server disconnect');
  assert.equal(apiCalls.tokenRefreshes, 1);
  // token 到期:等刷新带着新 token 重连,不拿旧 token 空转。
  assert.deepEqual(timers.delays(), []);
});

test('a handshake the server rejects is retried with jittered backoff; transport errors are left to socket.io', () => {
  const timers = createFakeTimers();
  const { manager, socket, store } = loadManager({}, {
    timers,
    random: () => 0.5,
  });
  manager.connectChat('jwt', 'u1');

  // 服务器暂时不可达:socket.io 自己按退避重连(active 仍为 true),这里不插手。
  socket.fire('connect_error', new Error('websocket error'));
  assert.deepEqual(timers.delays(), []);

  // 会话暂时无法校验(Redis/库抖动):服务端回 503,socket 被销毁、不会再自己连。
  const unavailable = () =>
    Object.assign(new Error('service_unavailable'), { data: { status: 503 } });
  socket.active = false;
  socket.fire('connect_error', unavailable());
  assert.deepEqual(timers.delays(), [2_000]);
  timers.run(2_000);
  assert.equal(socket.connectCalls, 1);
  assert.equal(store.connecting, true, '补连期间显示连接中');

  for (const expected of [5_000, 15_000, 30_000, 60_000, 60_000]) {
    socket.active = false;
    socket.fire('connect_error', unavailable());
    assert.deepEqual(timers.delays(), [expected]);
    timers.run(expected);
  }
  assert.equal(socket.connectCalls, 6);
});

test('backoff jitter spreads reconnects around the ladder step', () => {
  const low = createFakeTimers();
  const lowManager = loadManager({}, { timers: low, random: () => 0 });
  lowManager.manager.connectChat('jwt', 'u1');
  lowManager.socket.active = false;
  lowManager.socket.fire('connect_error', new Error('service_unavailable'));
  assert.deepEqual(low.delays(), [1_600]);

  const high = createFakeTimers();
  const highManager = loadManager({}, { timers: high, random: () => 0.999999 });
  highManager.manager.connectChat('jwt', 'u1');
  highManager.socket.active = false;
  highManager.socket.fire('connect_error', new Error('service_unavailable'));
  assert.deepEqual(high.delays(), [2_400]);
});

test('the reconnect ladder only starts over after a connection that stayed up', () => {
  const timers = createFakeTimers();
  const { manager, socket, clock } = loadManager({}, {
    timers,
    random: () => 0.5,
    fakeClock: true,
  });
  manager.connectChat('jwt', 'u1');

  // 连上就被踢(连接数超限、进房失败):每次 connect 都不算恢复,退避照样往上走,
  // 否则就是每 2 秒连一次、踢一次的死循环。
  for (const expected of [2_000, 5_000, 15_000]) {
    socket.fire('connect');
    clock.now += 1_000;
    socket.fire('disconnect', 'io server disconnect');
    assert.deepEqual(timers.delays(), [expected]);
    timers.run(expected);
  }

  // 稳定连了一阵之后再被断开,是一次新的故障:从头开始。
  socket.fire('connect');
  clock.now += 60_000;
  socket.fire('disconnect', 'io server disconnect');
  assert.deepEqual(timers.delays(), [2_000]);
});

test('an unauthorized handshake with a still-valid token refreshes once, then keeps retrying', async () => {
  const timers = createFakeTimers();
  const { manager, socket, apiCalls } = loadManager({}, {
    timers,
    random: () => 0.5,
  });
  manager.connectChat('jwt', 'u1');

  // 本机看 token 没过期、服务端却说未授权:时钟差(服务端看已过期)或会话被吊销,
  // 都该刷新一次。同时照排一次重连,刷新没换出新 token 也不会就此停住。
  socket.active = false;
  socket.fire('connect_error', new Error('unauthorized'));
  assert.equal(apiCalls.tokenRefreshes, 1);
  assert.deepEqual(timers.delays(), [2_000]);
  await flush();

  // 服务端内部出错也回 unauthorized:刷新过一次还被拒,就只退避重连,
  // 不能刷新 → 重连 → 再刷新地打转。
  timers.run(2_000);
  socket.active = false;
  socket.fire('connect_error', new Error('unauthorized'));
  assert.equal(apiCalls.tokenRefreshes, 1);
  assert.deepEqual(timers.delays(), [5_000]);
  timers.run(5_000);

  // 连上过就是新的故障窗口,下次再被拒可以再刷新一次。
  socket.fire('connect');
  socket.fire('disconnect', 'transport close');
  socket.active = false;
  socket.fire('connect_error', new Error('unauthorized'));
  assert.equal(apiCalls.tokenRefreshes, 2);
});

test('logging out or replacing the socket cancels a pending reconnect', () => {
  const timers = createFakeTimers();
  const { manager, socket } = loadManager({}, {
    timers,
    random: () => 0.5,
  });
  manager.connectChat('jwt', 'u1');
  socket.active = false;
  socket.fire('connect_error', new Error('service_unavailable'));
  assert.deepEqual(timers.delays(), [2_000]);

  manager.disconnectChat();
  assert.deepEqual(timers.delays(), []);

  // 登出后重新登录:退避从头数。
  manager.connectChat('jwt', 'u1');
  socket.active = false;
  socket.fire('connect_error', new Error('service_unavailable'));
  assert.deepEqual(timers.delays(), [2_000]);

  // token 轮换换了一条新 socket:旧的补连不能再去碰它。
  const connectsBefore = socket.connectCalls;
  manager.suspendChat();
  assert.deepEqual(timers.delays(), []);
  assert.equal(socket.connectCalls, connectsBefore);
});

test('token refresh is single-flight and gives up on a definitive auth failure', async () => {
  let rejectRefresh;
  const { manager, apiCalls } = loadManager({}, {
    refreshToken: () =>
      new Promise((_, reject) => {
        rejectRefresh = reject;
      }),
  });
  manager.connectChat('expired-jwt', 'u1');
  manager.connectChat('expired-jwt', 'u1');
  assert.equal(apiCalls.tokenRefreshes, 1, '在途刷新期间不能再发第二个');

  rejectRefresh(Object.assign(new Error('revoked'), { definitive: true }));
  await flush();
  // 服务端明确否认会话:由 API 层清会话,这里不再排重试。
  manager.connectChat('expired-jwt', 'u1');
  assert.equal(apiCalls.tokenRefreshes, 2);
});

test('a pending token refresh retry does not swallow the next foreground attempt', async () => {
  // 离线、token 已过期:刷新失败排了 5 秒后重试。这期间回前台又走一次 connectChat
  // (会话代数 +1)。原来那个排着的定时器挡住了这次刷新,自己到点又因为代数对不上
  // 直接退出 —— 重试链就此断掉,网回来了也一直连不上,直到再切一次前后台。
  const timers = createFakeTimers();
  let refreshOutcome = () => Promise.reject(new Error('offline'));
  const { manager, apiCalls } = loadManager({}, {
    timers,
    refreshToken: () => refreshOutcome(),
  });
  manager.connectChat('expired-jwt', 'u1');
  await flush();
  assert.equal(apiCalls.tokenRefreshes, 1);
  assert.deepEqual(timers.delays(), [5_000]);

  // 回前台:立刻再试一次,不被上一轮排着的重试挡住。
  manager.connectChat('expired-jwt', 'u1');
  assert.equal(apiCalls.tokenRefreshes, 2);
  await flush();
  assert.deepEqual(timers.delays(), [5_000], '只留一条重试,不叠');

  // 还是没网:重试照常接着跑。
  timers.run(5_000);
  assert.equal(apiCalls.tokenRefreshes, 3);
  refreshOutcome = () => Promise.resolve('fresh-token');
  await flush();
  timers.run(15_000);
  assert.equal(apiCalls.tokenRefreshes, 4);
});

test('a token refresh that fails while the app comes back to the foreground keeps retrying', async () => {
  const timers = createFakeTimers();
  let rejectRefresh;
  const { manager, apiCalls } = loadManager({}, {
    timers,
    refreshToken: () =>
      new Promise((_, reject) => {
        rejectRefresh = reject;
      }),
  });
  manager.connectChat('expired-jwt', 'u1');
  // 刷新还在路上时回前台:单飞,不发第二个。
  manager.connectChat('expired-jwt', 'u1');
  assert.equal(apiCalls.tokenRefreshes, 1);

  rejectRefresh(new Error('offline'));
  await flush();
  // 原来这条重试带着旧的会话代数,到点就退出了。
  timers.run(5_000);
  assert.equal(apiCalls.tokenRefreshes, 2);
});

test('logging out stops token refresh retries for that account', async () => {
  const timers = createFakeTimers();
  const { manager, apiCalls } = loadManager({}, {
    timers,
    refreshToken: () => Promise.reject(new Error('offline')),
  });
  manager.connectChat('expired-jwt', 'u1');
  await flush();
  assert.deepEqual(timers.delays(), [5_000]);
  manager.disconnectChat();
  assert.deepEqual(timers.delays(), []);
  assert.equal(apiCalls.tokenRefreshes, 1);
});

test('a push token confirmed after the handshake makes the live connection handshake again with it', () => {
  // 首次安装/新账号:聊天连接先连上,推送 token 的登记稍后才确认。握手时没带 token,
  // 服务端就认不出这台设备,开着 App 也照样给它发推送 —— 直到某次无关的重连。
  let registered = null;
  const { manager, socket, captured, announceRegisteredPushToken } = loadManager({}, {
    pushToken: (userId) => (userId === 'u1' ? registered : null),
  });
  manager.connectChat('jwt', 'u1');
  assert.equal(handshakeAuth(captured).pushToken, undefined);
  socket.connected = true;
  socket.fire('connect');
  let disconnects = 0;
  const disconnect = socket.disconnect;
  socket.disconnect = function countedDisconnect() {
    disconnects += 1;
    return disconnect.call(this);
  };

  registered = 'ExponentPushToken[fresh]';
  announceRegisteredPushToken({ userId: 'u1', token: 'ExponentPushToken[fresh]' });

  assert.equal(disconnects, 1);
  assert.equal(socket.connectCalls, 1, '断开后立刻重新握手');
  assert.equal(handshakeAuth(captured).pushToken, 'ExponentPushToken[fresh]');
});

test('a push token confirmation leaves the connection alone when it is not needed', () => {
  let registered = 'ExponentPushToken[same]';
  const { manager, socket, captured, announceRegisteredPushToken } = loadManager({}, {
    pushToken: () => registered,
  });
  manager.connectChat('jwt', 'u1');
  // 握手时已经带上了同一个 token:不用重连。
  assert.equal(handshakeAuth(captured).pushToken, 'ExponentPushToken[same]');
  socket.connected = true;
  socket.fire('connect');
  announceRegisteredPushToken({ userId: 'u1', token: 'ExponentPushToken[same]' });
  assert.equal(socket.connectCalls, 0);

  // 登记的是别的账号:不是这条连接的设备。
  registered = 'ExponentPushToken[other]';
  announceRegisteredPushToken({ userId: 'u2', token: 'ExponentPushToken[other]' });
  assert.equal(socket.connectCalls, 0);

  // 还没连上:下一次握手自己会带上,不必动它。
  socket.connected = false;
  announceRegisteredPushToken({ userId: 'u1', token: 'ExponentPushToken[other]' });
  assert.equal(socket.connectCalls, 0);
});

test('app background/foreground is reported in the handshake and on the live socket', () => {
  const { manager, socket, captured, store } = loadManager();
  manager.setChatAppState('background');
  assert.equal(store.appForeground, false);
  manager.connectChat('jwt', 'u1');
  // 后台建立的连接(安卓后台重连)一开始就按后台登记,不会先被当成「收得到」。
  assert.equal(handshakeAuth(captured).appState, 'background');
  socket.connected = true;
  socket.fire('connect');

  manager.setChatAppState('foreground');
  assert.equal(store.appForeground, true);
  // 握手已经带了后台,连上时不再重复报一次;之后的切换在活连接上报。
  assert.deepEqual(
    socket.emitted
      .filter((e) => e.event === 'chat:background' || e.event === 'chat:foreground')
      .map((e) => e.event),
    ['chat:foreground'],
  );
  // 状态没变不重复上报。
  manager.setChatAppState('foreground');
  assert.equal(
    socket.emitted.filter((e) => e.event === 'chat:foreground').length,
    1,
  );
});

test('auto-reconnect handshakes with the current app state, not the one from socket creation', () => {
  const { manager, socket, captured } = loadManager();
  manager.setChatAppState('background');
  manager.connectChat('jwt', 'u1');
  assert.equal(handshakeAuth(captured).appState, 'background');
  socket.connected = true;
  socket.fire('connect');
  manager.setChatAppState('foreground');

  // 断线后的自动重连不经过 connectChat:同一个 socket 拿同一份 auth 配置再握手。
  // 带着建连时的「后台」重连上去,服务端就把正在用 App 的人当成后台,照发推送。
  socket.connected = false;
  socket.fire('disconnect', 'transport close');
  assert.equal(handshakeAuth(captured).appState, 'foreground');
  socket.emitted.length = 0;
  socket.connected = true;
  socket.fire('connect');
  assert.deepEqual(
    socket.emitted.filter(
      (e) => e.event === 'chat:background' || e.event === 'chat:foreground',
    ),
    [],
  );
});

test('an app state switch while the handshake is in flight is reported once connected', () => {
  const { manager, socket, captured } = loadManager();
  manager.setChatAppState('background');
  manager.connectChat('jwt', 'u1');
  assert.equal(handshakeAuth(captured).appState, 'background');
  // 握手还没回来:切换只记下,没有活连接可报。
  manager.setChatAppState('foreground');
  assert.deepEqual(socket.emitted, []);

  socket.connected = true;
  socket.fire('connect');
  assert.deepEqual(
    socket.emitted
      .filter((e) => e.event === 'chat:background' || e.event === 'chat:foreground')
      .map((e) => e.event),
    ['chat:foreground'],
  );

  // 反方向同理:前台发起的握手途中退到后台。
  const second = loadManager();
  second.manager.connectChat('jwt', 'u1');
  assert.equal(handshakeAuth(second.captured).appState, 'foreground');
  second.manager.setChatAppState('background');
  second.socket.connected = true;
  second.socket.fire('connect');
  assert.deepEqual(
    second.socket.emitted
      .filter((e) => e.event === 'chat:background' || e.event === 'chat:foreground')
      .map((e) => e.event),
    ['chat:background'],
  );
});

test('the handshake names this device push token so only this device skips pushes', () => {
  const tokens = [];
  let registered = null;
  const { manager, captured } = loadManager(
    {},
    {
      pushToken: (userId) => {
        tokens.push(userId);
        return registered;
      },
    },
  );
  manager.connectChat('jwt', 'u1');
  // 推送还没登记确认:不带,服务端不按设备排除任何推送。
  assert.equal('pushToken' in handshakeAuth(captured), false);

  // 登记完成后,下一次握手(包括自动重连)现取。
  registered = 'ExponentPushToken[phone]';
  assert.equal(handshakeAuth(captured).pushToken, 'ExponentPushToken[phone]');
  assert.deepEqual(tokens, ['u1', 'u1']);
});

test('connects with token in the handshake auth frame, never in the URL', () => {
  const { manager, socket, captured, diagnostics } = loadManager();
  manager.connectChat('jwt-token', 'u1');
  assert.equal(captured.url, 'http://api.test');
  assert.equal(captured.opts.path, '/chat-ws');
  const auth = handshakeAuth(captured);
  assert.equal(auth.token, 'jwt-token');
  assert.equal(auth.appState, 'foreground');
  assert.equal(auth.traceId, 'ws-123e4567-e89b-42d3-a456-426614174000');
  assert.equal(
    captured.opts.extraHeaders['x-connection-trace-id'],
    auth.traceId,
  );
  assert.deepEqual(Array.from(captured.opts.transports), ['websocket']);
  assert.doesNotMatch(captured.url, /token=/);

  assert.equal(diagnostics[0].event, 'chat.ws.connecting');
  assert.equal(diagnostics[0].details.stage, 'handshake');
  assert.equal(diagnostics[0].details.platform, 'android');
  socket.fire('connect');
  assert.equal(diagnostics[1].event, 'chat.ws.connected');
  assert.equal(diagnostics[1].details.stage, 'ready');
  assert.equal(diagnostics[1].details.platform, 'android');
  socket.fire('disconnect', 'transport error');
  assert.equal(diagnostics[2].event, 'chat.ws.disconnected');
  assert.equal(diagnostics[2].details.stage, 'ready');
  assert.equal(diagnostics[2].details.reason, 'transport_error');
  assert.equal(diagnostics[2].details.platform, 'android');
  assert.doesNotMatch(JSON.stringify(diagnostics), /jwt-token/);
});

test('a send that never gets a connection fails after a minute, not at once', async () => {
  const timers = createFakeTimers();
  const { manager } = loadManager({}, { timers });
  let outcome = null;
  manager
    .sendChatMessage({
      conversationId: 'c1',
      type: 'text',
      content: { text: 'hi' },
      d: 'd1',
    })
    .catch((err) => {
      outcome = err.code;
    });
  await flush();
  assert.equal(outcome, null, '没连上先排队,不立刻标红');

  timers.run(60_000);
  await flush();
  assert.equal(outcome, 'CHAT_NOT_CONNECTED');
});

test('a message sent while disconnected goes out with the same d once reconnected', async () => {
  const timers = createFakeTimers();
  const { manager, socket } = loadManager({}, { timers });
  manager.connectChat('jwt', 'u1');
  const payload = {
    conversationId: 'c1',
    type: 'text',
    content: { text: 'hi' },
    d: 'd-offline',
  };
  const sent = manager.sendChatMessage(payload);
  const sendsOnWire = () =>
    socket.emitted.filter((entry) => entry.event === 'chat:send');
  assert.equal(sendsOnWire().length, 0);

  socket.ackResponder = (event, wire, cb) =>
    cb(null, { ok: true, messageId: 'm1', height: 7, d: wire.d });
  socket.connected = true;
  socket.fire('connect');
  assert.deepEqual(
    sendsOnWire().map((entry) => entry.payload.d),
    ['d-offline'],
  );
  assert.deepEqual(await sent, { ok: true, messageId: 'm1', height: 7, d: 'd-offline' });
});

test('an ack lost to a disconnect is resent with the same d after the reconnect', async () => {
  const timers = createFakeTimers();
  const { manager, socket } = loadManager({}, { timers });
  manager.connectChat('jwt', 'u1');
  socket.connected = true;
  socket.fire('connect');
  let ackCallback = null;
  socket.ackResponder = (event, wire, cb) => {
    ackCallback = cb;
  };
  const sent = manager.sendChatMessage({
    conversationId: 'c1',
    type: 'text',
    content: { text: 'hi' },
    d: 'd-lost',
  });

  // 断线:socket.io 把没回的 ack 以错误结束。
  socket.connected = false;
  socket.fire('disconnect', 'transport close');
  ackCallback(new Error('socket has been disconnected'));
  await flush();

  socket.ackResponder = (event, wire, cb) =>
    cb(null, { ok: true, messageId: 'm1', height: 3, d: wire.d });
  socket.connected = true;
  socket.fire('connect');
  const ack = await sent;
  assert.equal(ack.messageId, 'm1');
  assert.deepEqual(
    socket.emitted
      .filter((entry) => entry.event === 'chat:send')
      .map((entry) => entry.payload.d),
    ['d-lost', 'd-lost'],
  );
});

test('a token rotation keeps queued messages; logging out or switching accounts drops them', async () => {
  const timers = createFakeTimers();
  const { manager, socket } = loadManager({}, { timers });
  const outcomes = {};
  const send = (d) =>
    manager
      .sendChatMessage({ conversationId: 'c1', type: 'text', content: { text: d }, d })
      .then(
        () => {
          outcomes[d] = 'sent';
        },
        (err) => {
          outcomes[d] = err.code;
        },
      );

  manager.connectChat('jwt', 'u1');
  send('kept');
  // token 轮换:挂起再用新 token 连同一个人。
  manager.suspendChat();
  manager.connectChat('jwt-2', 'u1');
  await flush();
  assert.equal(outcomes.kept, undefined);
  socket.ackResponder = (event, wire, cb) =>
    cb(null, { ok: true, messageId: `m-${wire.d}`, height: 1, d: wire.d });
  socket.connected = true;
  socket.fire('connect');
  await flush();
  assert.equal(outcomes.kept, 'sent');

  socket.ackResponder = null;
  socket.connected = false;
  send('logged-out');
  manager.disconnectChat();
  await flush();
  assert.equal(outcomes['logged-out'], 'CHAT_NOT_CONNECTED');

  manager.connectChat('jwt', 'u1');
  send('other-account');
  manager.connectChat('jwt-b', 'u2');
  await flush();
  assert.equal(outcomes['other-account'], 'CHAT_NOT_CONNECTED');
  socket.connected = true;
  socket.fire('connect');
  assert.equal(
    socket.emitted.filter((entry) => entry.event === 'chat:send' && entry.payload.d !== 'kept').length,
    0,
    '换了账号的连接不能替上一个账号发消息',
  );
});

test('sendChatMessage resolves on ok ack and surfaces server error codes', async () => {
  const { manager, socket } = loadManager();
  manager.connectChat('jwt', 'u1');
  socket.connected = true;

  socket.ackResponder = (event, payload, cb) =>
    cb(null, { ok: true, messageId: 'm1', height: 3, d: payload.d });
  const ack = await manager.sendChatMessage({
    conversationId: 'c1',
    type: 'text',
    content: { text: 'hi' },
    d: 'd1',
  });
  assert.deepEqual(ack, { ok: true, messageId: 'm1', height: 3, d: 'd1' });

  socket.ackResponder = (event, payload, cb) =>
    cb(null, { ok: false, code: 'CHAT_SENSITIVE_WORD_BLOCKED' });
  await assert.rejects(
    manager.sendChatMessage({
      conversationId: 'c1',
      type: 'text',
      content: { text: 'bad' },
      d: 'd2',
    }),
    (err) => err.code === 'CHAT_SENSITIVE_WORD_BLOCKED',
  );
});

test('offline reads merge to the max height and flush once on connect', async () => {
  const { manager, socket } = loadManager();
  manager.connectChat('jwt', 'u1');
  // 未连接:两次上报只在本地合并,不产生任何 emit。
  const acked = [];
  socket.ackResponder = (event, payload, cb) => {
    acked.push(payload);
    cb(null, { ok: true });
  };
  manager.markChatRead('c1', 3);
  manager.markChatRead('c1', 7);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(acked.length, 0);

  // 连接建立:合并后的最大水位单次上报。
  socket.connected = true;
  socket.fire('connect');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(acked.length, 1);
  assert.equal(acked[0].conversationId, 'c1');
  assert.equal(acked[0].height, 7);
});

test('switching accounts drops the previous account pending read watermarks', async () => {
  const { manager, socket } = loadManager();
  manager.connectChat('jwt-a', 'account-a');
  manager.markChatRead('a-private-conversation', 9);

  manager.connectChat('jwt-b', 'account-b');
  const acked = [];
  socket.ackResponder = (event, payload, cb) => {
    acked.push(payload);
    cb(null, { ok: true });
  };
  socket.connected = true;
  socket.fire('connect');
  await flush();

  assert.deepEqual(acked, []);
});

test('a stale pending-read load cannot survive an A-B-A switch', async () => {
  let resolveFirstPendingReads;
  const firstPendingReads = new Promise((resolve) => {
    resolveFirstPendingReads = resolve;
  });
  let pendingReadCalls = 0;
  const { manager, socket } = loadManager({
    initChatLocalDb: async () => true,
    readLocalConversations: async () => [],
    outboxList: async () => [],
    pendingReadsList: async () => {
      pendingReadCalls += 1;
      return pendingReadCalls === 1 ? firstPendingReads : [];
    },
  });

  manager.connectChat('jwt-a1', 'account-a');
  await flush();
  await flush();
  manager.connectChat('jwt-b', 'account-b');
  manager.connectChat('jwt-a2', 'account-a');
  resolveFirstPendingReads([{ conversationId: 'stale-a-read', height: 8 }]);
  await flush();
  await flush();

  const acked = [];
  socket.ackResponder = (event, payload, cb) => {
    acked.push(payload);
    cb(null, { ok: true });
  };
  socket.connected = true;
  socket.fire('connect');
  await flush();

  assert.ok(!acked.some((payload) => payload.conversationId === 'stale-a-read'));
});

test('reads queued during an in-flight flush trigger a follow-up round', async () => {
  const { manager, socket } = loadManager();
  manager.connectChat('jwt', 'u1');
  socket.connected = true;
  const acked = [];
  let releaseFirstAck;
  const firstAckGate = new Promise((resolve) => {
    releaseFirstAck = resolve;
  });
  socket.ackResponder = (event, payload, cb) => {
    acked.push(payload);
    if (acked.length === 1) {
      // 第一条 ack 挂起,模拟慢网:此间入队的新水位不能滞留。
      void firstAckGate.then(() => cb(null, { ok: true }));
      return;
    }
    cb(null, { ok: true });
  };

  manager.markChatRead('c1', 3);
  manager.markChatRead('c2', 9);
  releaseFirstAck();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  const byConversation = new Map(acked.map((p) => [p.conversationId, p.height]));
  assert.equal(byConversation.get('c1'), 3);
  assert.equal(byConversation.get('c2'), 9);
});

test('failed read acks are retained and re-flushed on reconnect', async () => {
  const { manager, socket } = loadManager();
  manager.connectChat('jwt', 'u1');
  socket.connected = true;
  const attempts = [];
  socket.ackResponder = (event, payload, cb) => {
    attempts.push(payload);
    cb(new Error('timeout'));
  };
  manager.markChatRead('c1', 5);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(attempts.length, 1);

  // 重连:connect 钩子触发 flush,失败的水位再次上报。
  socket.ackResponder = (event, payload, cb) => {
    attempts.push(payload);
    cb(null, { ok: true });
  };
  socket.fire('connect');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(attempts.length, 2);
  assert.equal(attempts[1].conversationId, 'c1');
  assert.equal(attempts[1].height, 5);
});

test('disconnectChat resets the store and invalidates the session generation', () => {
  const { manager, socket, store, bound } = loadManager();
  manager.connectChat('jwt', 'u1');
  assert.equal(bound.length, 1);
  const { isLive } = bound[0];
  assert.equal(isLive(), true);
  manager.disconnectChat();
  // 断开后:分发器的存活检查失效,旧会话事件全部丢弃。
  assert.equal(isLive(), false);
  assert.ok(store.calls.some(([name]) => name === 'reset'));
  assert.equal(socket.handlers.size, 0);
});

test('a connected socket bound to a different user is replaced, not kept', () => {
  const { manager, socket, store, bound } = loadManager();
  // 冷启动:磁盘上的 user 快照是上一个账号的,先用它连上了。
  manager.connectChat('jwt', 'stale-user');
  socket.connected = true;
  socket.fire('connect');
  assert.equal(store.currentUserId, 'stale-user');
  const staleIsLive = bound[0].isLive;

  // /auth/me 回来,权威用户是另一个人:必须换身份重连 —— 只看 connected 的话
  // 那条错身份的连接会一直留着,自己发的消息被判成收到的,未读也跟着错。
  manager.connectChat('jwt', 'real-user');
  assert.equal(store.currentUserId, 'real-user');
  assert.ok(store.calls.some(([name]) => name === 'reset'));
  // 旧连接的 session generation 作废,它上面到达的事件不会写进新身份的 store。
  assert.equal(staleIsLive(), false);
  assert.equal(bound.length, 2);
});

test('reconnecting as the same user on a live socket stays a no-op', () => {
  const { manager, socket, store } = loadManager();
  manager.connectChat('jwt', 'u1');
  socket.connected = true;
  socket.fire('connect');
  const callsBefore = store.calls.length;

  // 回前台补连 / token 轮换:同一个人,不能把连接推倒重来。
  manager.connectChat('jwt', 'u1');
  assert.equal(store.calls.length, callsBefore);
  assert.ok(!store.calls.some(([name]) => name === 'reset'));
});

test('reports the first chat connection failure with bounded correlation context', () => {
  const { manager, socket, reports, diagnostics, captured } = loadManager();
  manager.connectChat('jwt-secret', 'u1');

  socket.fire('connect_error', new Error('unauthorized jwt-secret'));
  assert.equal(reports.length, 1);
  assert.equal(reports[0].error.message, 'chat connection failed');
  assert.equal(reports[0].context.operation, 'chatConnect');
  assert.equal(reports[0].context.kind, 'unauthorized');
  assert.equal(reports[0].context.failureKind, 'connect_error');
  assert.equal(reports[0].context.attempts, 1);
  assert.equal(reports[0].context.stage, 'handshake');
  assert.equal(reports[0].context.reason, 'unauthorized');
  assert.equal(reports[0].context.source, 'websocket');
  assert.equal(reports[0].context.endpointPath, '/chat-ws');
  assert.equal(reports[0].context.platform, 'android');
  assert.equal(reports[0].context.traceId, handshakeAuth(captured).traceId);
  assert.doesNotMatch(JSON.stringify(reports), /jwt-secret/);
  assert.equal(diagnostics.at(-1).event, 'chat.ws.connect_error');
  assert.equal(diagnostics.at(-1).details.stage, 'handshake');
  assert.equal(diagnostics.at(-1).details.reason, 'unauthorized');
  assert.equal(diagnostics.at(-1).details.platform, 'android');

  socket.fire('connect_error', new Error('unauthorized jwt-secret'));
  assert.equal(reports.length, 1, 'one outage must not spam Sentry');
  socket.fire('connect');
  socket.fire('connect_error', new Error('new outage'));
  assert.equal(reports.length, 2, 'a recovered connection starts a new outage window');
});

test('one prolonged outage stays one report across socket replacements', () => {
  // 设备一直离线时,SessionBootstrap 每次回到前台都会调 connectChat,access token
  // 轮换也会。那条路会换掉这个连不上的 socket —— 如果顺手把「本次断网已上报」
  // 的标志清掉,用户每切一次前后台就多一条同样的 Sentry 事件。
  const { manager, socket, reports } = loadManager();
  manager.connectChat('jwt', 'u1');
  socket.fire('connect_error', new Error('network down'));
  assert.equal(reports.length, 1);

  manager.connectChat('jwt', 'u1');
  socket.fire('connect_error', new Error('network down'));
  manager.connectChat('jwt', 'u1');
  socket.fire('connect_error', new Error('network down'));
  assert.equal(
    reports.length,
    1,
    '同一次断网里换 socket 不该重新开一次上报窗口',
  );

  // 真的连上过,才算这次断网结束。
  socket.fire('connect');
  socket.fire('connect_error', new Error('network down again'));
  assert.equal(reports.length, 2);
});

test('switching accounts starts a fresh outage window', () => {
  // 换账号是真正的会话边界:新账号第一次就连不上,值得单独报一条。
  const { manager, socket, reports } = loadManager();
  manager.connectChat('jwt', 'u1');
  socket.fire('connect_error', new Error('network down'));
  assert.equal(reports.length, 1);

  manager.connectChat('jwt', 'u2');
  socket.fire('connect_error', new Error('network down'));
  assert.equal(reports.length, 2);
});

test('logging out and back in starts a fresh outage window', () => {
  // 登出会 reset store(currentUserId 归 null),再登录同一账号走不到「换账号」
  // 分支;「本次断网已上报」的标志必须在登出边界清掉,否则新会话第一次连不上
  // 就永远报不出去。
  const { manager, socket, reports } = loadManager();
  manager.connectChat('jwt', 'u1');
  socket.fire('connect_error', new Error('network down'));
  assert.equal(reports.length, 1);

  manager.disconnectChat();
  manager.connectChat('jwt', 'u1');
  socket.fire('connect_error', new Error('network still down'));
  assert.equal(reports.length, 2, '登出再登录是新的会话,首个失败要重新上报');
  assert.equal(reports[1].context.attempts, 1, '失败计数也要从头数');
});

// detail 查询里被请求却拿到 null 的人要清掉本地状态 —— 对方刚关掉「显示在线
// 时间」时服务端就是这么回的。不清就会把旧的在线状态一直挂在界面上。
// 空 ack 是另一回事(限流/出错),那时什么都不能动。
test('presence query clears users the server marks invisible', () => {
  const { manager, socket, store } = loadManager();
  manager.connectChat('jwt', 'u1');
  socket.connected = true;
  store.applyPresence('peer', true, null);
  store.applyPresence('gone', true, null);

  socket.ackResponder = (event, _payload, cb) => {
    if (event === 'chat:presence') {
      cb(null, {
        peer: { online: false, lastSeenAt: '2026-09-11T08:00:00.000Z' },
        gone: null,
      });
    }
  };
  manager.queryChatPresence(['peer', 'gone', 'omitted']);

  assert.equal(store.onlineByUser.peer, false);
  assert.equal(store.lastSeenByUser.peer, '2026-09-11T08:00:00.000Z');
  assert.ok(!('gone' in store.onlineByUser), '服务端说不可见的人要被清掉');
  assert.ok(!('omitted' in store.onlineByUser), '旧服务端省略的人同样清掉');
});

test('an empty presence ack leaves known state alone', () => {
  const { manager, socket, store } = loadManager();
  manager.connectChat('jwt', 'u1');
  socket.connected = true;
  store.applyPresence('peer', true, null);

  socket.ackResponder = (event, _payload, cb) => {
    if (event === 'chat:presence') cb(null, {});
  };
  manager.queryChatPresence(['peer']);

  // 限流/出错也是空 ack —— 不能把它当成「这个人不可见」。
  assert.equal(store.onlineByUser.peer, true);
});

test('typing is throttled locally per conversation', () => {
  const { manager, socket } = loadManager();
  manager.connectChat('jwt', 'u1');
  socket.connected = true;
  manager.sendChatTyping('c1', 'direct');
  manager.sendChatTyping('c1', 'direct');
  manager.sendChatTyping('c2', 'group');
  const typingEvents = socket.emitted.filter((e) => e.event === 'chat:typing');
  assert.equal(typingEvents.length, 2);
});

// 隐私页的「单聊 / 群聊输入状态」:门禁在发送侧这一个出口,按会话类型各管各的。
test('typing respects the per-kind privacy switches', () => {
  const { manager, socket, store } = loadManager();
  manager.connectChat('jwt', 'u1');
  socket.connected = true;
  store.setViewerTypingPolicy({ direct: false, group: true });
  manager.sendChatTyping('c1', 'direct');
  manager.sendChatTyping('c2', 'group');
  const typingEvents = socket.emitted.filter((e) => e.event === 'chat:typing');
  assert.equal(typingEvents.length, 1);
  assert.match(JSON.stringify(typingEvents[0]), /c2/);

  store.setViewerTypingPolicy({ direct: true, group: false });
  manager.sendChatTyping('c3', 'group');
  assert.equal(
    socket.emitted.filter((e) => e.event === 'chat:typing').length,
    1,
    '群聊开关关掉后不再上报',
  );
});

test('connect applies the cached typing policy and the server refresh overrides it', async () => {
  const { manager, socket, store, mmkvStore } = loadManager(
    {},
    {
      privacyFetch: () =>
        Promise.resolve({
          messageSelfDestructSec: 0,
          shareTypingInDirect: true,
          shareTypingInGroup: false,
        }),
    },
  );
  mmkvStore.set(
    'chat.viewerTypingPolicy.u1',
    JSON.stringify({ direct: false, group: true }),
  );

  manager.connectChat('jwt', 'u1');
  // 冷启动先用按账号缓存的开关门禁,不等网络。
  assert.deepEqual(store.viewerTypingPolicy, { direct: false, group: true });

  socket.fire('connect');
  for (let i = 0; i < 4; i += 1) await Promise.resolve();

  assert.deepEqual(store.viewerTypingPolicy, { direct: true, group: false });
  assert.equal(
    mmkvStore.get('chat.viewerTypingPolicy.u1'),
    JSON.stringify({ direct: true, group: false }),
    '服务端的值要落回按账号缓存,下次冷启动直接可用',
  );
});

/** 等 hydrateFromLocalDb 那串 await 跑完(它是 void 出去的,没法直接 await)。 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test('冷启动水合:outbox 里那条其实已经发出去了,不能再标成发送失败', async () => {
  // 真实形态:消息发成功了,但出队那一下没落盘(裸 DELETE 撞进别人的事务被
  // 一起回滚)。本地时间线里明明躺着同 d 的已确认消息(height>0),而 outbox
  // 行还在 —— 每次冷启动都会拿 height=0 的占位把它顶掉再标红,
  // 进会话拉到真历史才好,退出来又坏。
  const deleted = [];
  const { manager, store } = loadManager({
    initChatLocalDb: async () => true,
    readLocalConversations: async () => [{ id: 'c1' }],
    readRecentLocalMessages: async () => [
      { id: 'srv-1', conversationId: 'c1', height: 7, d: 'd-sent', type: 'text' },
    ],
    outboxList: async () => [
      {
        d: 'd-sent',
        conversationId: 'c1',
        payload: { conversationId: 'c1', type: 'text', content: {}, d: 'd-sent' },
        // 相对时间:写死日期会在「日期 + 2 天视角自毁窗口」过点后转入过期
        // 清除分支,测试从此不再走自己声称的路径(2026-08-13 就爆过一次)。
        createdAt: new Date(Date.now() - 60_000).toISOString(),
      },
    ],
    outboxDelete: async (d) => {
      deleted.push(d);
    },
  });

  manager.connectChat('jwt', 'u1');
  await flush();

  assert.deepEqual(store.failedMarks, []);
  // 已确认的那条必须原样留着,不能被 height=0 的占位顶掉。
  assert.deepEqual(
    store.messagesByConversation.c1.map((m) => [m.id, m.height]),
    [['srv-1', 7]],
  );
  // 并且这行 outbox 要就地出队,别让它每次启动都重来一遍。
  assert.deepEqual(deleted, ['d-sent']);
});

test('冷启动水合:真没发出去的那条照旧还原成失败气泡', async () => {
  const deleted = [];
  const { manager, store } = loadManager({
    initChatLocalDb: async () => true,
    readLocalConversations: async () => [{ id: 'c1' }],
    // 只有乐观占位(height=0),没有服务端确认过的版本。
    readRecentLocalMessages: async () => [],
    outboxList: async () => [
      {
        d: 'd-lost',
        conversationId: 'c1',
        payload: { conversationId: 'c1', type: 'text', content: {}, d: 'd-lost' },
        // 相对时间:写死日期会在「日期 + 2 天视角自毁窗口」过点后转入过期
        // 清除分支,测试从此不再走自己声称的路径(2026-08-13 就爆过一次)。
        createdAt: new Date(Date.now() - 60_000).toISOString(),
        failedAfterHeight: 4,
      },
    ],
    outboxDelete: async (d) => {
      deleted.push(d);
    },
  });

  manager.connectChat('jwt', 'u1');
  await flush();

  assert.deepEqual(store.failedMarks, [{ conversationId: 'c1', d: 'd-lost' }]);
  assert.equal(
    store.messagesByConversation.c1[0].failedAfterHeight,
    4,
    '冷启动后失败气泡的位置锚点丢失',
  );
  assert.deepEqual(deleted, []);
});

test('冷启动水合:媒体转发从 outbox 恢复本地预览而不恢复源 object key', async () => {
  const { manager, store } = loadManager({
    initChatLocalDb: async () => true,
    readLocalConversations: async () => [{ id: 'c1' }],
    readRecentLocalMessages: async () => [],
    outboxList: async () => [
      {
        d: 'd-forward',
        conversationId: 'c1',
        payload: {
          conversationId: 'c1',
          type: 'image',
          content: {},
          d: 'd-forward',
          forwardFromMessageId: 'source-1',
          localPreviewContent: {
            url: 'https://signed.example/source.jpg',
            width: 640,
            height: 480,
          },
        },
        createdAt: new Date(Date.now() - 60_000).toISOString(),
      },
    ],
  });

  manager.connectChat('jwt', 'u1');
  await flush();

  const restored = store.messagesByConversation.c1[0];
  assert.deepEqual(JSON.parse(JSON.stringify(restored.content)), {
    url: 'https://signed.example/source.jpg',
    width: 640,
    height: 480,
  });
  assert.equal('key' in restored.content, false);
});

test('冷启动水合:转账卡片的 outbox 脏数据直接清掉,不还原成失败气泡', async () => {
  // 后端 GiftCardOutboxProcessor 补发的那张卡用的是 gift_card_<id>,
  // 和客户端的 d 不是一个键 —— 「同 d 已确认」的判据永远匹配不上。
  // 留着的话:height=0 排在时间线最底下(新消息都跑到它上面),
  // 会话列表还一直给最新那条挂「[发送失败]」前缀。
  const deleted = [];
  const { manager, store } = loadManager({
    initChatLocalDb: async () => true,
    readLocalConversations: async () => [{ id: 'c1' }],
    // 后端补发的卡在时间线里,但它的 d 与 outbox 那条不同。
    readRecentLocalMessages: async () => [
      {
        id: 'srv-card',
        conversationId: 'c1',
        height: 9,
        d: 'gift_card_42',
        type: 'transfer-card',
      },
    ],
    outboxList: async () => [
      {
        d: 'd-card',
        conversationId: 'c1',
        payload: {
          conversationId: 'c1',
          type: 'transfer-card',
          content: { amount: 100 },
          d: 'd-card',
        },
        createdAt: new Date(Date.now() - 60_000).toISOString(),
      },
    ],
    outboxDelete: async (d) => {
      deleted.push(d);
    },
  });

  manager.connectChat('jwt', 'u1');
  await flush();

  assert.deepEqual(store.failedMarks, []);
  assert.deepEqual(deleted, ['d-card']);
  assert.deepEqual(
    store.messagesByConversation.c1.map((m) => m.id),
    ['srv-card'],
  );
});

test('冷启动水合:验证卡片的 outbox 脏数据同样清掉', async () => {
  // 验证卡与转账卡同源:旧版本客户端也会把它当普通消息发,发送必失败,
  // 条目就永远留在本地队列里。它的服务端键是 verification_card_<...>,
  // 同样对不上客户端的 d —— 装了新版本的老用户本地还躺着这些脏条目,
  // 不清的话每次冷启动都还原出一张发不出去的幽灵卡。
  const deleted = [];
  const { manager, store } = loadManager({
    initChatLocalDb: async () => true,
    readLocalConversations: async () => [{ id: 'c1' }],
    readRecentLocalMessages: async () => [],
    outboxList: async () => [
      {
        d: 'd-verify',
        conversationId: 'c1',
        payload: {
          conversationId: 'c1',
          type: 'verification-card',
          content: { invitationId: 'inv-1' },
          d: 'd-verify',
        },
        createdAt: new Date(Date.now() - 60_000).toISOString(),
      },
    ],
    outboxDelete: async (d) => {
      deleted.push(d);
    },
  });

  manager.connectChat('jwt', 'u1');
  await flush();

  assert.deepEqual(store.failedMarks, []);
  assert.deepEqual(deleted, ['d-verify']);
  assert.deepEqual(store.messagesByConversation.c1 ?? [], []);
});

test('冷启动水合:没传完的媒体从持久副本还原成带本地预览的失败气泡', async () => {
  const deleted = [];
  const { manager, store, apiCalls } = loadManager(
    {
      initChatLocalDb: async () => true,
      readLocalConversations: async () => [{ id: 'c1' }],
      readRecentLocalMessages: async () => [],
      outboxList: async () => [
        {
          d: 'd-photo',
          conversationId: 'c1',
          // 上传还没完成:content 里没有 object key。
          payload: {
            conversationId: 'c1',
            type: 'image',
            content: {},
            d: 'd-photo',
            pendingMedia: {
              type: 'image',
              fileName: 'media.jpg',
              uploadName: 'IMG_0001.jpg',
              contentType: 'image/jpeg',
              width: 1200,
              height: 900,
            },
          },
          createdAt: new Date(Date.now() - 60_000).toISOString(),
        },
        {
          d: 'd-gone',
          conversationId: 'c1',
          payload: {
            conversationId: 'c1',
            type: 'voice',
            content: {},
            d: 'd-gone',
            pendingMedia: {
              type: 'voice',
              fileName: 'media.m4a',
              uploadName: 'rec.m4a',
              contentType: 'audio/mp4',
              duration: 4,
            },
          },
          createdAt: new Date(Date.now() - 60_000).toISOString(),
        },
      ],
      outboxDelete: async (d) => {
        deleted.push(d);
      },
    },
    {
      // 容器路径每次启动都会变:地址必须现拼,不能是 outbox 里存的。
      pendingMediaUris: { 'd-photo': 'file:///run-2/chat-outbox/u1/d-photo/media.jpg' },
    },
  );

  manager.connectChat('jwt', 'u1');
  await flush();

  const restored = store.messagesByConversation.c1;
  assert.deepEqual(
    restored.map((m) => m.d),
    ['d-photo'],
  );
  assert.deepEqual(JSON.parse(JSON.stringify(restored[0].content)), {
    localUri: 'file:///run-2/chat-outbox/u1/d-photo/media.jpg',
    width: 1200,
    height: 900,
  });
  assert.deepEqual(store.failedMarks, [{ conversationId: 'c1', d: 'd-photo' }]);
  // 副本没了、服务端也没有这条:无从重发,出队而不是留一个永远发不出去的红气泡。
  assert.deepEqual(deleted, ['d-gone']);
  // 清孤儿时只留还被引用、副本还在的那条。
  assert.deepEqual(apiCalls.pendingMediaPrunes, [['d-photo']]);
});

test('冷启动水合:outbox 读不出来时不清理待发媒体副本', async () => {
  const { manager, apiCalls } = loadManager({
    initChatLocalDb: async () => true,
    readLocalConversations: async () => [{ id: 'c1' }],
    readRecentLocalMessages: async () => [],
    // 读失败返回 null:当成「没有待发」会删光所有没发出去的照片和录音。
    readOutboxEntries: async () => null,
  });

  manager.connectChat('jwt', 'u1');
  await flush();

  assert.deepEqual(apiCalls.pendingMediaPrunes, []);
});
