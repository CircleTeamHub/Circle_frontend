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
    if (request === '@/services/api/utils') {
      // 白名单替身:只放行本站来源(与其它 chat 用例同款)。
      return {
        allowPeerMediaUrl: (u) =>
          typeof u === 'string' && u.startsWith('https://cdn.trusted/') ? u : null,
      };
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

const DIRECT_ID = 'direct:0000-a:ffff-b';

function directConversation(overrides = {}) {
  return {
    id: DIRECT_ID,
    type: 'DIRECT',
    peer: { id: 'peer', nickname: '备注名', avatarUrl: 'https://cdn.trusted/p.png' },
    circleId: null,
    circle: null,
    ...overrides,
  };
}

test('the first message from a new contact still raises a banner', () => {
  // 会话不在快照里(对方刚建的单聊)。补拉要等 800ms 防抖 + 一次请求,
  // 横幅错过这一下就再也不会补 —— 用户在非消息页完全收不到提示。
  const { socket, state } = loadDispatcher({ conversations: [] });
  socket.emit(
    'chat:msg',
    dto({
      conversationId: DIRECT_ID,
      sender: { id: 'peer', nickname: '新朋友', avatarUrl: 'https://cdn.trusted/p.png' },
    }),
  );

  assert.equal(state.banners.length, 1);
  const banner = state.banners[0];
  assert.equal(banner.title, '新朋友');
  assert.equal(banner.conversationType, 'private');
  // 跳转目标必须是对端 uuid,否则点开进不去。
  assert.equal(banner.sourceID, 'peer');
  assert.equal(banner.conversationID, DIRECT_ID);
});

test('an unknown group conversation raises no banner (no title, no route)', () => {
  // 群横幅要圈子名与圈子 id,消息里一个都没有。拿发送者去凑会弹出错的标题、
  // 点进去还进错房间 —— 不如不弹,等补拉后由下一条消息带出来。
  const { socket, state } = loadDispatcher({ conversations: [] });
  socket.emit('chat:msg', dto({ conversationId: 'grp-1' }));
  assert.equal(state.banners.length, 0);
  // 但补拉照常安排,会话行与角标不会一直缺着。
  assert.equal(state.ingested.length, 1);
});

test('known conversations still win over the sender fallback', () => {
  const { socket, state } = loadDispatcher({
    conversations: [directConversation()],
  });
  socket.emit(
    'chat:msg',
    dto({
      conversationId: DIRECT_ID,
      sender: { id: 'peer', nickname: '原始昵称', avatarUrl: null },
    }),
  );
  // 会话行上的名字(可能是本地备注)优先于消息里的昵称。
  assert.equal(state.banners[0].title, '备注名');
});

test('banner avatars go through the media allowlist', () => {
  const { socket, state } = loadDispatcher({ conversations: [] });
  socket.emit(
    'chat:msg',
    dto({
      conversationId: DIRECT_ID,
      sender: { id: 'peer', nickname: '新朋友', avatarUrl: 'https://attacker/1.gif' },
    }),
  );
  // 横幅一出现就会自动发起这次图片请求 —— 未授权来源必须落成占位。
  assert.equal(state.banners[0].avatarUrl, null);
});

test('self messages and the open conversation never raise a banner', () => {
  const { socket, state } = loadDispatcher({
    conversations: [directConversation()],
    activeConversationId: DIRECT_ID,
  });
  socket.emit('chat:msg', dto({ conversationId: DIRECT_ID }));
  assert.equal(state.banners.length, 0);

  const other = loadDispatcher({ conversations: [directConversation()] });
  other.socket.emit(
    'chat:msg',
    dto({
      conversationId: DIRECT_ID,
      sender: { id: 'me', nickname: '我', avatarUrl: null },
    }),
  );
  assert.equal(other.state.banners.length, 0);
});
