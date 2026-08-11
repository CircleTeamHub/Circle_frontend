const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

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

function runModule(rel, stubs) {
  const context = {
    console: { warn: () => {}, error: () => {} },
    setTimeout,
    clearTimeout,
    Date,
    Math,
    JSON,
    Promise,
    module: { exports: {} },
    exports: {},
    require: (request) => {
      if (request in stubs) return stubs[request];
      if (request === './local-db') return __localDbStub;
    throw new Error(`unexpected require: ${request}`);
    },
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

function loadManager(localDbOverrides = {}, options = {}) {
  const { io, socket, captured } = fakeSocketFactory();
  const reports = [];
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
      viewerSelfDestructDays: 0,
      viewerSelfDestructPolicyRevision: 0,
      setViewerSelfDestructDays(v, writeOptions) {
        state.viewerSelfDestructDays = v;
        if (!writeOptions?.remoteRefresh) {
          state.viewerSelfDestructPolicyRevision += 1;
        }
        state.calls.push(['setViewerSelfDestructDays', v]);
        if (state.currentUserId) {
          mmkvStore.set(
            `chat.viewerSelfDestructDays.${state.currentUserId}`,
            String(v),
          );
        }
      },
      setError(v) {
        state.error = v;
      },
      purgeExpiredBurnMessages: async () => {},
      reset() {
        state.calls.push(['reset']);
        state.connected = false;
        state.currentUserId = null;
      },
      activeConversationId: null,
      messagesByConversation: {},
      // 冷启动水合会用到这三个;默认 initChatLocalDb=false 时根本走不到,
      // 只有显式打开本地库的用例才会触发。
      hydrated: [],
      failedMarks: [],
      hydrateLocalSnapshot(conversations, timelines) {
        state.hydrated.push({ conversations, timelines });
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
      droppedCachedMessages: 0,
      dropCachedMessages() {
        state.droppedCachedMessages += 1;
        state.messagesByConversation = {};
      },
    };
    return {
      useChatStore: { getState: () => state },
      sanitizeExpiredConversationPreviews: (conversations, days, now = Date.now()) =>
        conversations.map((conversation) => {
          const seconds = days > 0 ? days * 24 * 60 * 60 : null;
          const createdAt = Date.parse(conversation.lastMessage?.createdAt ?? '');
          return seconds && Number.isFinite(createdAt) && createdAt < now - seconds * 1000
            ? { ...conversation, lastMessage: null, lastMessageAt: null, unreadCount: 0 }
            : conversation;
        }),
      viewerSelfDestructDaysStorageKey: (userId) =>
        `chat.viewerSelfDestructDays.${userId}`,
      state,
    };
  })();
  const bound = [];
  // 重连对账(G-13)的观测点:列表刷新次数与缺口补拉参数。
  const apiCalls = {
    conversations: 0,
    backfills: [],
    mutationSyncs: [],
    /** 依次弹出的 fetchChatMutationsSince 响应(测分页追平用)。 */
    mutationPages: [],
    mutationCursorIds: [],
    droppedLocalMessages: 0,
    initialHistory: [],
    privacyFetches: 0,
    privacyResponse: { messageSelfDestructDays: 2 },
  };
  const mmkvStore = new Map();
  const mmkv = {
    getString: (key) => mmkvStore.get(key),
    set: (key, value) => mmkvStore.set(key, String(value)),
    remove: (key) => mmkvStore.delete(key),
  };
  const protocol = runModule('src/chat-core/protocol.ts', {});
  const manager = runModule('src/chat-core/socket-manager.ts', {
    'socket.io-client': { io },
    '@/constants/config': { CHAT_WS_URL: 'http://api.test' },
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
        return Promise.resolve([]);
      },
      backfillConversationSince: (conversationId, afterHeight) => {
        apiCalls.backfills.push({ conversationId, afterHeight });
        return Promise.resolve();
      },
      fetchChatMutationsSince: (since, sinceId) => {
        apiCalls.mutationSyncs.push(since);
        apiCalls.mutationCursorIds.push(sinceId ?? '');
        const next = apiCalls.mutationPages.shift();
        return Promise.resolve(
          next ?? {
            messages: [],
            serverTime: new Date().toISOString(),
            nextSince: new Date().toISOString(),
            nextSinceId: '',
            hasMore: false,
            resetRequired: false,
          },
        );
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
      pendingReadUpsert: async () => {},
      pendingReadDelete: async () => {},
      pendingReadsList: async () => [],
      initChatLocalDb: async () => false,
      dropAllLocalMessages: async () => {
        apiCalls.droppedLocalMessages += 1;
      },
      ...localDbOverrides,
    },
    './app-badge': { initChatAppBadgeSync: () => {} },
    // 离线撤回增量的游标落 MMKV,按 userId 分键;测试里用一个内存替身。
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
  });
  return {
    manager,
    socket,
    captured,
    store: storeModule.state,
    bound,
    apiCalls,
    reports,
    mmkvStore,
  };
}

test('viewer self-destruct uses the cached policy offline and refreshes it after connect', async () => {
  const { manager, socket, store, apiCalls, mmkvStore } = loadManager();
  mmkvStore.set('chat.viewerSelfDestructDays.u1', '7');

  manager.connectChat('jwt', 'u1');
  assert.equal(store.viewerSelfDestructDays, 7);

  socket.fire('connect');
  for (let i = 0; i < 4; i += 1) await Promise.resolve();

  assert.equal(apiCalls.privacyFetches, 1);
  assert.equal(store.viewerSelfDestructDays, 2);
  assert.equal(mmkvStore.get('chat.viewerSelfDestructDays.u1'), '2');
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

  resolvePolicy({ messageSelfDestructDays: 2 });
  await flush();
  await flush();

  assert.equal(store.viewerSelfDestructDays, 2);
  assert.ok(store.hydrated.length > 0);
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

test('a stale policy refresh cannot overwrite a newer local setting', async () => {
  let resolvePolicy;
  const policy = new Promise((resolve) => {
    resolvePolicy = resolve;
  });
  const { manager, socket, store } = loadManager({}, { privacyFetch: () => policy });

  manager.connectChat('jwt', 'u1');
  socket.fire('connect');
  store.setViewerSelfDestructDays(7);
  resolvePolicy({ messageSelfDestructDays: 2 });
  await flush();

  assert.equal(store.viewerSelfDestructDays, 7);
});

test('reconnect (not first connect) refreshes conversations and backfills the active gap', () => {
  const { manager, socket, store, apiCalls } = loadManager();
  manager.connectChat('jwt', 'u1');
  socket.fire('connect');
  // 首连不对账:冷启动全量拉取由页面 focus 负责。
  assert.equal(apiCalls.conversations, 0);
  assert.deepEqual(apiCalls.backfills, []);

  socket.fire('disconnect');
  store.activeConversationId = 'c1';
  store.messagesByConversation = {
    c1: [{ height: 4 }, { height: 9 }, { height: 0 }],
  };
  socket.fire('connect');
  // 重连:列表刷新一次 + 当前会话从本地最高 height(乐观消息的 0 不算)追平。
  assert.equal(apiCalls.conversations, 1);
  assert.deepEqual(apiCalls.backfills, [
    { conversationId: 'c1', afterHeight: 9 },
  ]);
  // 撤回不改 height —— afterHeight 补拉结构上够不着,必须另追一趟。
  // 首连已经把游标种下,这一次追的是那个游标,不是「此刻」。
  assert.equal(apiCalls.mutationSyncs.length, 1);
});

test('the very first outage is covered by a cursor seeded at first connect', async () => {
  const { manager, socket, apiCalls } = loadManager();
  manager.connectChat('jwt', 'u1');
  socket.fire('connect');
  await Promise.resolve();
  // 首连不拉增量(没有本地历史可言),但必须把游标种下。
  assert.deepEqual(apiCalls.mutationSyncs, []);

  socket.fire('disconnect');
  socket.fire('connect');
  await Promise.resolve();

  // 原来这里 lastMutationSyncAt 还是 null,于是「以现在为起点」问一遍 ——
  // 断线窗口里发生的撤回被整段跳过,而 height 没变,任何补拉都够不着它。
  assert.equal(apiCalls.mutationSyncs.length, 1);
  const asked = Date.parse(apiCalls.mutationSyncs[0]);
  assert.ok(Number.isFinite(asked));
  assert.ok(asked <= Date.now(), 'cursor must predate this reconnect');
});

test('a cold start catches up from the persisted cursor', async () => {
  const first = loadManager();
  first.manager.connectChat('jwt', 'u1');
  first.socket.fire('connect');
  await Promise.resolve();
  const seeded = first.mmkvStore.get('chat.mutationCursor.u1');
  assert.ok(seeded, 'first connect must persist a cursor');
  first.manager.disconnectChat();

  // 新进程(内存清零),MMKV 还在:上次退出到这次启动之间的撤回必须追。
  const next = loadManager();
  next.mmkvStore.set('chat.mutationCursor.u1', seeded);
  next.manager.connectChat('jwt', 'u1');
  next.socket.fire('connect');
  await Promise.resolve();

  assert.deepEqual(next.apiCalls.mutationSyncs, [seeded]);
});

test('catch-up keeps paging while the server reports hasMore', async () => {
  const { manager, socket, apiCalls, mmkvStore } = loadManager();
  mmkvStore.set('chat.mutationCursor.u1', '2026-08-10T00:00:00.000Z');
  apiCalls.mutationPages.push(
    {
      messages: [],
      serverTime: '2026-08-10T05:00:00.000Z',
      nextSince: '2026-08-10T01:00:00.000Z',
      nextSinceId: 'm-42',
      hasMore: true,
      resetRequired: false,
    },
    {
      messages: [],
      serverTime: '2026-08-10T05:00:00.000Z',
      nextSince: '2026-08-10T05:00:00.000Z',
      nextSinceId: '',
      hasMore: false,
      resetRequired: false,
    },
  );

  manager.connectChat('jwt', 'u1');
  socket.fire('connect');
  for (let i = 0; i < 8; i += 1) await Promise.resolve();

  // 单页有上限:只拉一页的话,被截断的那些撤回会被游标永久跳过。
  assert.deepEqual(apiCalls.mutationSyncs, [
    '2026-08-10T00:00:00.000Z',
    '2026-08-10T01:00:00.000Z',
  ]);
  assert.equal(mmkvStore.get('chat.mutationCursor.u1'), '2026-08-10T05:00:00.000Z');
  // 复合游标:第二页必须带上第一页最后一条的 id,否则同毫秒的其余变更被跳过。
  assert.deepEqual(apiCalls.mutationCursorIds, ['', 'm-42']);
});

test('resetRequired drops the cached messages instead of pretending to be caught up', async () => {
  const { manager, socket, store, apiCalls, mmkvStore } = loadManager();
  mmkvStore.set('chat.mutationCursor.u1', '2026-06-01T00:00:00.000Z');
  store.messagesByConversation = { c1: [{ height: 3 }] };
  apiCalls.mutationPages.push({
    messages: [],
    serverTime: '2026-08-10T05:00:00.000Z',
    nextSince: '2026-08-10T05:00:00.000Z',
    nextSinceId: '',
    hasMore: false,
    resetRequired: true,
  });

  manager.connectChat('jwt', 'u1');
  socket.fire('connect');
  for (let i = 0; i < 8; i += 1) await Promise.resolve();

  // 游标比服务端保留窗口还老:那段区间的撤回已经查不到了,缓存里的消息会
  // 永远显示原文 —— 只能整体作废重新拉,不能装作追平了。
  assert.equal(apiCalls.droppedLocalMessages, 1);
  assert.equal(store.droppedCachedMessages, 1);
  assert.equal(mmkvStore.get('chat.mutationCursor.u1'), '2026-08-10T05:00:00.000Z');
});

test('token rotation (suspend + reconnect) still counts as a reconnect', () => {
  const { manager, socket, store, apiCalls } = loadManager();
  manager.connectChat('jwt', 'u1');
  socket.fire('connect');
  assert.equal(apiCalls.conversations, 0);

  // access token 轮换走的是 suspendChat + connectChat:换的是一条**新 socket**。
  // 判据挂在 socket 上的话这条新连接永远算首连,断开窗口里的消息一条都不补。
  manager.suspendChat();
  store.activeConversationId = 'c1';
  store.messagesByConversation = { c1: [{ height: 7 }] };
  manager.connectChat('jwt-rotated', 'u1');
  socket.fire('connect');

  assert.equal(apiCalls.conversations, 1);
  assert.deepEqual(apiCalls.backfills, [
    { conversationId: 'c1', afterHeight: 7 },
  ]);
});

test('reconnect with an empty active timeline loads the first history page', () => {
  const { manager, socket, store, apiCalls } = loadManager();
  manager.connectChat('jwt', 'u1');
  socket.fire('connect');
  socket.fire('disconnect');
  // 打开会话时正好断网、首屏 REST 也失败 —— 一条确认消息都没有。
  store.activeConversationId = 'c1';
  store.messagesByConversation = { c1: [] };
  socket.fire('connect');

  // 直接 return 的话这条唯一的恢复路径也放弃了,会话一直空着。
  assert.deepEqual(apiCalls.backfills, []);
  assert.deepEqual(apiCalls.initialHistory, ['c1']);
});

test('connects with token in the handshake auth frame, never in the URL', () => {
  const { manager, captured } = loadManager();
  manager.connectChat('jwt-token', 'u1');
  assert.equal(captured.url, 'http://api.test');
  assert.equal(captured.opts.path, '/chat-ws');
  assert.equal(captured.opts.auth.token, 'jwt-token');
  assert.deepEqual(Array.from(captured.opts.transports), ['websocket']);
  assert.doesNotMatch(captured.url, /token=/);
});

test('sendChatMessage rejects when not connected', async () => {
  const { manager } = loadManager();
  await assert.rejects(
    manager.sendChatMessage({
      conversationId: 'c1',
      type: 'text',
      content: { text: 'hi' },
      d: 'd1',
    }),
    (err) => err.code === 'CHAT_NOT_CONNECTED',
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

test('reports one sanitized chat connection issue after three consecutive failures', () => {
  const { manager, socket, reports } = loadManager();
  manager.connectChat('jwt-secret', 'u1');

  socket.fire('connect_error', new Error('failed with jwt-secret'));
  socket.fire('connect_error', new Error('failed with jwt-secret'));
  assert.equal(reports.length, 0);

  socket.fire('connect_error', new Error('failed with jwt-secret'));
  socket.fire('connect_error', new Error('failed with jwt-secret'));
  assert.equal(reports.length, 1);
  assert.equal(reports[0].error.message, 'chat connection failed repeatedly');
  assert.equal(reports[0].context.operation, 'chatConnect');
  assert.equal(reports[0].context.kind, 'consecutiveFailures');
  assert.equal(reports[0].context.attempts, 3);
  assert.doesNotMatch(JSON.stringify(reports), /jwt-secret/);

  socket.fire('connect');
  socket.fire('connect_error', new Error('new outage'));
  socket.fire('connect_error', new Error('new outage'));
  socket.fire('connect_error', new Error('new outage'));
  assert.equal(reports.length, 2, 'a recovered connection starts a new outage window');
});

test('typing is throttled locally per conversation', () => {
  const { manager, socket } = loadManager();
  manager.connectChat('jwt', 'u1');
  socket.connected = true;
  manager.sendChatTyping('c1');
  manager.sendChatTyping('c1');
  manager.sendChatTyping('c2');
  const typingEvents = socket.emitted.filter((e) => e.event === 'chat:typing');
  assert.equal(typingEvents.length, 2);
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
        createdAt: '2026-08-11T01:00:00.000Z',
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
        createdAt: '2026-08-11T01:00:00.000Z',
      },
    ],
    outboxDelete: async (d) => {
      deleted.push(d);
    },
  });

  manager.connectChat('jwt', 'u1');
  await flush();

  assert.deepEqual(store.failedMarks, [{ conversationId: 'c1', d: 'd-lost' }]);
  assert.deepEqual(deleted, []);
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
        createdAt: '2026-08-11T01:23:00.000Z',
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
