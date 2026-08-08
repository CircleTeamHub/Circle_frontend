const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// 分发器是服务端事件进 store 的唯一入口:它放行什么,store 里就有什么。
// 用真 protocol.ts(校验器) + store/通知 store 的桩,断言行为而非源码字符串。
function transpile(rel) {
  const filePath = path.join(process.cwd(), rel);
  return ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;
}

function runModule(rel, requireImpl) {
  const context = {
    Date,
    Number,
    Array,
    setTimeout,
    clearTimeout,
    console: { warn: () => {} },
    module: { exports: {} },
    exports: {},
    require: requireImpl,
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpile(rel), context);
  return context.module.exports;
}

/** socket.io 的极简替身:记下 handler,测试直接触发。 */
function fakeSocket() {
  const handlers = new Map();
  return {
    on: (event, handler) => handlers.set(event, handler),
    emit: (event, payload) => handlers.get(event)?.(payload),
  };
}

function loadDispatcher(storeOverrides = {}) {
  const state = {
    currentUserId: 'me',
    activeConversationId: null,
    conversations: [],
    ingested: [],
    banners: [],
    backfills: 0,
    ...storeOverrides,
  };
  const storeState = {
    get currentUserId() {
      return state.currentUserId;
    },
    get activeConversationId() {
      return state.activeConversationId;
    },
    get conversations() {
      return state.conversations;
    },
    applyIncomingMessage: (message) =>
      state.conversations.some((c) => c.id === message.conversationId),
    ingestMessages: (conversationId, messages) => {
      for (const message of messages) state.ingested.push(message);
    },
    applyRead: () => {},
    applyPresence: () => {},
  };

  const dispatcher = runModule('src/chat-core/dispatcher.ts', (request) => {
    if (request === './protocol') {
      return runModule('src/chat-core/protocol.ts', () => {
        throw new Error('protocol should have no runtime deps');
      });
    }
    if (request === './store') return { useChatStore: { getState: () => storeState } };
    if (request === './api') {
      return {
        loadChatConversations: async () => {
          state.backfills += 1;
          return [];
        },
      };
    }
    if (request === './mappers') {
      return { getChatMessagePreview: (m) => String(m.content?.text ?? '[消息]') };
    }
    if (request === '@/features/notifications/store/use-notification-snackbar-store') {
      return {
        useNotificationSnackbarStore: {
          getState: () => ({
            enqueueChatMessage: (item) => state.banners.push(item),
          }),
        },
      };
    }
    throw new Error(`unexpected require: ${request}`);
  });

  const socket = fakeSocket();
  dispatcher.bindChatEvents(socket, () => true);
  return { socket, state, dispatcher };
}

function dto(overrides = {}) {
  return {
    id: 'm1',
    conversationId: 'c1',
    height: 3,
    type: 'text',
    content: { text: 'hi' },
    sender: { id: 'peer', nickname: '对方', avatarUrl: null },
    replyToId: null,
    d: null,
    createdAt: '2026-08-05T12:00:00.000Z',
    ...overrides,
  };
}

test('a well-formed chat:msg reaches the store', () => {
  const { socket, state } = loadDispatcher();
  socket.emit('chat:msg', dto());
  assert.equal(state.ingested.length, 1);
});

test('malformed payloads never reach the store', () => {
  const { socket, state } = loadDispatcher();
  const bad = [
    null,
    undefined,
    'not-an-object',
    [],
    dto({ id: '' }),
    dto({ conversationId: 42 }),
    dto({ type: '' }),
    // 这一条是最要命的:content=null 落库后,MessagesScreen 渲染时
    // getChatMessagePreview 读 content['text'] 抛异常 —— 已在分发器
    // try/catch 之外,消息页每次进都白屏,且它还落了库修不掉。
    dto({ content: null }),
    dto({ content: 'text' }),
    dto({ height: -1 }),
    dto({ height: 1.5 }),
    dto({ height: 'nope' }),
    dto({ createdAt: 'yesterday' }),
    dto({ createdAt: 123 }),
    dto({ sender: { nickname: '没有 id' } }),
    dto({ sender: 'peer' }),
    dto({ replyToId: 7 }),
    dto({ d: {} }),
  ];
  for (const payload of bad) {
    socket.emit('chat:msg', payload);
  }
  assert.equal(state.ingested.length, 0, 'a malformed payload was stored');
});

test('system messages with a null sender are still valid', () => {
  const { socket, state } = loadDispatcher();
  socket.emit('chat:msg', dto({ type: 'system', sender: null }));
  assert.equal(state.ingested.length, 1);
});
