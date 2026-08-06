const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

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
    };
    return { useChatStore: { getState: () => state }, state };
  })();
  const bound = [];
  const protocol = runModule('src/chat-core/protocol.ts', {});
  const manager = runModule('src/chat-core/socket-manager.ts', {
    'socket.io-client': { io },
    '@/constants/config': { CHAT_WS_URL: 'http://api.test' },
    './dispatcher': {
      bindChatEvents: (sock, isLive) => bound.push({ sock, isLive }),
    },
    './protocol': protocol,
    './store': storeModule,
  });
  return { manager, socket, captured, store: storeModule.state, bound };
}

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
