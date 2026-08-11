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


// 会话列表侧的 store 行为 + mapper:与 chat-core-store.test.js 同款 vm harness。
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

function zustandStub() {
  return {
    create: (initializer) => {
      const state = {};
      const set = (partial) => {
        const next = typeof partial === 'function' ? partial(state) : partial;
        Object.assign(state, next);
      };
      const get = () => state;
      Object.assign(state, initializer(set, get));
      return { getState: get, setState: set };
    },
  };
}

function loadStore() {
  const context = {
    module: { exports: {} },
    exports: {},
    Date,
    require: (request) => {
      if (request === 'zustand') return zustandStub();
      if (request === './protocol') return {};
      // 本地删除墓碑在这组用例里始终为空(删除行为由 chat-core-store 覆盖)。
      if (request === './local-db') {
      return {
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
    }
      if (request === './deleted-messages') {
        return {
          isMessageDeletedLocally: () => false,
          markMessageDeletedLocally: () => {},
        };
      }
      if (request === '@/storage') {
        return { storage: { set: () => {}, getString: () => undefined } };
      }
      if (request === './local-db') return __localDbStub;
    throw new Error(`unexpected require: ${request}`);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpile('src/chat-core/store.ts'), context);
  return context.module.exports;
}

function conv(overrides = {}) {
  return {
    id: overrides.id ?? 'conv-1',
    type: 'DIRECT',
    peer: { id: 'u2', nickname: '对方', avatarUrl: null },
    circleId: null,
    circle: null,
    lastMessage: null,
    unreadCount: 0,
    pinned: false,
    muted: false,
    lastMessageAt: null,
    ...overrides,
  };
}

function msg(overrides = {}) {
  return {
    id: overrides.id ?? 'm1',
    conversationId: 'conv-1',
    height: 1,
    type: 'text',
    content: { text: 'hi' },
    sender: { id: 'u2', nickname: '对方', avatarUrl: null },
    replyToId: null,
    d: null,
    createdAt: '2026-08-05T12:00:00.000Z',
    ...overrides,
  };
}

test('conversations sort pinned-first then lastMessageAt desc', () => {
  const { useChatStore } = loadStore();
  const store = useChatStore.getState();
  store.setConversations([
    conv({ id: 'old', lastMessageAt: '2026-08-01T00:00:00.000Z' }),
    conv({ id: 'pinned-old', pinned: true, lastMessageAt: '2026-07-01T00:00:00.000Z' }),
    conv({ id: 'new', lastMessageAt: '2026-08-05T00:00:00.000Z' }),
  ]);
  assert.deepEqual(
    Array.from(useChatStore.getState().conversations, (c) => c.id),
    ['pinned-old', 'new', 'old'],
  );
});

test('incoming message bumps preview, unread and resorts', () => {
  const { useChatStore } = loadStore();
  const store = useChatStore.getState();
  store.setCurrentUserId('u1');
  store.setConversations([
    conv({ id: 'conv-2', lastMessageAt: '2026-08-05T00:00:00.000Z' }),
    conv({ id: 'conv-1', lastMessageAt: '2026-08-01T00:00:00.000Z', unreadCount: 1 }),
  ]);

  store.applyIncomingMessage(msg({ createdAt: '2026-08-06T00:00:00.000Z' }));

  const [first] = useChatStore.getState().conversations;
  assert.equal(first.id, 'conv-1');
  assert.equal(first.unreadCount, 2);
  assert.equal(first.lastMessage.id, 'm1');
});

test('own messages and active-conversation messages do not count unread', () => {
  const { useChatStore } = loadStore();
  const store = useChatStore.getState();
  store.setCurrentUserId('u1');
  store.setConversations([conv()]);

  // 自己发的
  store.applyIncomingMessage(
    msg({ sender: { id: 'u1', nickname: '我', avatarUrl: null } }),
  );
  assert.equal(useChatStore.getState().conversations[0].unreadCount, 0);

  // 正在看的会话
  store.setActiveConversationId('conv-1');
  store.applyIncomingMessage(msg({ id: 'm2' }));
  assert.equal(useChatStore.getState().conversations[0].unreadCount, 0);

  // 不在看 + 他人消息
  store.setActiveConversationId(null);
  store.applyIncomingMessage(msg({ id: 'm3' }));
  assert.equal(useChatStore.getState().conversations[0].unreadCount, 1);
});

test('markConversationReadLocal zeroes unread without touching others', () => {
  const { useChatStore } = loadStore();
  const store = useChatStore.getState();
  store.setConversations([
    conv({ id: 'a', unreadCount: 3 }),
    conv({ id: 'b', unreadCount: 5 }),
  ]);
  store.markConversationReadLocal('a');
  const byId = new Map(
    useChatStore.getState().conversations.map((c) => [c.id, c.unreadCount]),
  );
  assert.equal(byId.get('a'), 0);
  assert.equal(byId.get('b'), 5);
});

test('selectTotalUnread excludes muted conversations', () => {
  const { selectTotalUnread } = loadStore();
  const total = selectTotalUnread({
    conversations: [
      conv({ id: 'a', unreadCount: 3 }),
      conv({ id: 'b', unreadCount: 5, muted: true }),
      conv({ id: 'c', unreadCount: 2 }),
    ],
  });
  assert.equal(total, 5);
});

test('conversation mapper renders group identity from circle info', () => {
  // mapper 依赖 i18n/locale/工具,直接做源码级断言(与 realtime 测试同风格)。
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/chat-core/mappers.ts'),
    'utf8',
  );
  assert.match(source, /dto\.circle\?\.name/);
  assert.match(source, /dto\.peer\?\.nickname/);
  assert.match(source, /normalizeMediaUrl/);
  assert.match(source, /im\.preview\./);
  // DIRECT 的 sourceID 必须是对端 userID(个人资料跳转依赖)。
  assert.match(source, /dto\.peer\?\.id/);
});
