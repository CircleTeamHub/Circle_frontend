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

function loadManager() {
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
      setError(v) {
        state.error = v;
      },
      reset() {
        state.calls.push(['reset']);
        state.connected = false;
        state.currentUserId = null;
      },
      activeConversationId: null,
      messagesByConversation: {},
    };
    return { useChatStore: { getState: () => state }, state };
  })();
  const bound = [];
  // 重连对账(G-13)的观测点:列表刷新次数与缺口补拉参数。
  const apiCalls = {
    conversations: 0,
    backfills: [],
    mutationSyncs: [],
    initialHistory: [],
  };
  const protocol = runModule('src/chat-core/protocol.ts', {});
  const manager = runModule('src/chat-core/socket-manager.ts', {
    'socket.io-client': { io },
    '@/constants/config': { CHAT_WS_URL: 'http://api.test' },
    './api': {
      loadChatConversations: () => {
        apiCalls.conversations += 1;
        return Promise.resolve([]);
      },
      backfillConversationSince: (conversationId, afterHeight) => {
        apiCalls.backfills.push({ conversationId, afterHeight });
        return Promise.resolve();
      },
      fetchChatMutationsSince: (since) => {
        apiCalls.mutationSyncs.push(since);
        return Promise.resolve(new Date().toISOString());
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
    },
    './app-badge': { initChatAppBadgeSync: () => {} },
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
  };
}

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
  assert.equal(apiCalls.mutationSyncs.length, 1);
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
