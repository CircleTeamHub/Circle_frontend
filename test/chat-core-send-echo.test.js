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
  purgeExpiredLocalMessages: async () => {},
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


// 发送 ack 与服务端 chat:msg 回声是两条独立的路,谁先到不定。
// 回声先到时它才是权威版本(服务端规范化过的 content、服务端时间戳);
// ack 路径拿本地乐观对象拼出来的那份是合成品,还带着只该留在本机的 localUri。
// 用真 store(mergeMessages 按 id 覆盖)跑,断言合成品不会盖掉权威那条。
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

function runModule(rel, requireImpl, extraGlobals = {}) {
  const context = {
    Date,
    Math,
    Number,
    module: { exports: {} },
    exports: {},
    require: requireImpl,
    ...extraGlobals,
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpile(rel), context);
  return context.module.exports;
}

function zustandStub() {
  const makeStore = (initializer) => {
    const state = {};
    const set = (partial) => {
      const next = typeof partial === 'function' ? partial(state) : partial;
      Object.assign(state, next);
    };
    Object.assign(state, initializer(set, () => state));
    return { getState: () => state, setState: set };
  };
  return {
    create: (initializer) =>
      initializer === undefined ? makeStore : makeStore(initializer),
  };
}

function loadSendStack({ onSend, outboxEntries = [], onBackfill = () => {} }) {
  const store = runModule('src/chat-core/store.ts', (request) => {
    if (request === 'zustand') return zustandStub();
    // protocol.ts 零依赖:跑真的,别桩 —— SERVER_COMPENSATED_TYPES 是生产常量。
    if (request === './protocol')
      return runModule('src/chat-core/protocol.ts', () => {
        throw new Error('protocol should have no runtime deps');
      });
    if (request === './local-db') {
      return {
        persistLocalConversations: async () => {},
        upsertLocalConversation: async () => {},
        removeLocalConversation: async () => {},
        persistLocalMessages: async () => {},
        deleteLocalMessage: async () => {},
        purgeExpiredLocalMessages: async () => {},
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
  });

  const client = runModule('src/chat-core/client.ts', (request) => {
    if (request === '@/services/api/credit-policy') {
      return { assertLocalCanSendMessage: () => {} };
    }
    if (request === '@/stores/authStore') {
      return {
        useAuthStore: {
          getState: () => ({
            user: { id: 'me', nickname: '我', avatarUrl: null },
            sessionEpoch: 1,
          }),
        },
      };
    }
    if (request === './api') {
      return {
        createCircleChatConversation: async () => ({ id: 'c1' }),
        createDirectChatConversation: async () => ({ id: 'c1' }),
        loadChatHistory: async () => ({ messages: [], nextBeforeHeight: null }),
        backfillConversationSince: async (conversationId, afterHeight) => {
          onBackfill(conversationId, afterHeight);
        },
      };
    }
    if (request === './send-errors') return { reportChatSendFailure: () => {} };
    if (request === './socket-manager') {
      return {
        createDeliveryId: () => 'd-test',
        markConversationRead: () => {},
        sendChatMessage: onSend,
      };
    }
    if (request === './store') return store;
    // protocol.ts 零依赖:跑真的,别桩 —— SERVER_COMPENSATED_TYPES 是生产常量。
    if (request === './protocol')
      return runModule('src/chat-core/protocol.ts', () => {
        throw new Error('protocol should have no runtime deps');
      });
    if (request === './local-db')
      return { ...__localDbStub, outboxList: async () => outboxEntries };
    throw new Error(`unexpected require: ${request}`);
  });

  return { client, store };
}

test('a server echo that beats the ack is not overwritten by the synthetic confirmation', async () => {
  let deliverEcho = null;
  const { client, store } = loadSendStack({
    onSend: async () => {
      // 回声在 ack 落地之前到达(分发器已经把权威 DTO 写进 store)。
      deliverEcho();
      return { messageId: 'srv-1', height: 9 };
    },
  });

  const state = store.useChatStore.getState();
  state.setCurrentUserId('me');
  state.setConversations([
    {
      id: 'c1',
      type: 'DIRECT',
      peer: { id: 'peer', nickname: '对方', avatarUrl: null },
      circleId: null,
      circle: null,
      lastMessage: null,
      unreadCount: 0,
      pinned: false,
      muted: false,
      lastMessageAt: null,
    },
  ]);

  const authoritative = {
    id: 'srv-1',
    conversationId: 'c1',
    height: 9,
    type: 'image',
    // 服务端规范化后的 content:只有 key 与现签 url,没有本机路径。
    content: { key: 'chat/me/a.jpg', url: 'https://cdn.trusted/a.jpg' },
    sender: { id: 'me', nickname: '我', avatarUrl: null },
    replyToId: null,
    d: 'd-test',
    createdAt: '2026-08-05T12:00:05.000Z',
  };
  deliverEcho = () => {
    const s = store.useChatStore.getState();
    s.applyIncomingMessage(authoritative);
    s.ingestMessages('c1', [authoritative]);
  };

  const result = await client.sendImageMessage({
    conversationId: 'c1',
    key: 'chat/me/a.jpg',
    localUri: 'file:///tmp/a.jpg',
  });

  const timeline = store.useChatStore.getState().messagesByConversation['c1'];
  assert.equal(timeline.length, 1);
  const stored = timeline[0];
  assert.equal(stored.id, 'srv-1');
  // 服务端时间戳与规范化 content 必须留着。
  assert.equal(stored.createdAt, '2026-08-05T12:00:05.000Z');
  assert.equal(stored.content.url, 'https://cdn.trusted/a.jpg');
  // 只该留在本机的 localUri 绝不能被合成确认写回权威那条上。
  assert.equal(stored.content.localUri, undefined);
  // 会话预览同理。
  assert.equal(
    store.useChatStore.getState().conversations[0].lastMessage.createdAt,
    '2026-08-05T12:00:05.000Z',
  );
  // 调用方拿到的也是权威那条。
  assert.equal(result.id, 'srv-1');
  assert.equal(result.createdAt, '2026-08-05T12:00:05.000Z');
});

test('without an echo the ack still confirms the optimistic message', async () => {
  const { client, store } = loadSendStack({
    onSend: async () => ({ messageId: 'srv-2', height: 4 }),
  });
  const state = store.useChatStore.getState();
  state.setCurrentUserId('me');
  state.setConversations([]);

  const result = await client.sendTextMessage({ conversationId: 'c1', text: 'hi' });
  const timeline = store.useChatStore.getState().messagesByConversation['c1'];
  assert.equal(timeline.length, 1);
  assert.equal(timeline[0].id, 'srv-2');
  assert.equal(timeline[0].height, 4);
  assert.equal(result.id, 'srv-2');
});

// 重发命中服务端幂等分支时不会有 chat:msg 回声,只能拿本地乐观内容拼一条
// confirmed 落库。对转发媒体来说那份内容是**源**对象的展示字段(object key 被
// 刻意剥掉了):签名 url 一过期本地就是坏图,而且没有 key 可以重新签。
test('a no-echo retry of forwarded media reconciles against the canonical message', async () => {
  const backfills = [];
  const { client, store } = loadSendStack({
    onSend: async () => ({ messageId: 'srv-9', height: 12 }),
    outboxEntries: [
      {
        d: 'd-fwd',
        conversationId: 'c1',
        createdAt: '2026-08-19T10:00:00.000Z',
        payload: {
          type: 'image',
          content: {},
          forwardFromMessageId: 'src-1',
          localPreviewContent: {
            url: 'https://signed/source.jpg',
            width: 800,
            height: 600,
          },
        },
      },
    ],
    onBackfill: (conversationId, afterHeight) =>
      backfills.push([conversationId, afterHeight]),
  });
  const state = store.useChatStore.getState();
  state.setCurrentUserId('me');
  state.setConversations([]);

  await client.retryFailedChatMessage('c1', 'd-fwd');

  // 气泡还是要先转正,否则「明明发出去了却一直红着」那个老毛病就回来了。
  const timeline = store.useChatStore.getState().messagesByConversation['c1'];
  assert.equal(timeline.length, 1);
  assert.equal(timeline[0].id, 'srv-9');
  assert.equal(timeline[0].height, 12);
  // 转正之后必须补拉权威消息,把那份非权威 content 换掉。
  assert.deepEqual(backfills, [['c1', 11]]);
});

test('a no-echo retry without a local preview does not backfill', async () => {
  // 纯文本重发的乐观内容就是发出去的那份,本来就权威,不该多跑一趟网络。
  const backfills = [];
  const { client, store } = loadSendStack({
    onSend: async () => ({ messageId: 'srv-10', height: 3 }),
    outboxEntries: [
      {
        d: 'd-text',
        conversationId: 'c1',
        createdAt: '2026-08-19T10:00:00.000Z',
        payload: { type: 'text', content: { text: 'hi' } },
      },
    ],
    onBackfill: (...args) => backfills.push(args),
  });
  const state = store.useChatStore.getState();
  state.setCurrentUserId('me');
  state.setConversations([]);

  await client.retryFailedChatMessage('c1', 'd-text');

  assert.deepEqual(backfills, []);
});

test('video send keeps local preview off the wire while retaining playback metadata', async () => {
  let sentPayload;
  const { client } = loadSendStack({
    onSend: async (payload) => {
      sentPayload = payload;
      return { messageId: 'srv-video', height: 6 };
    },
  });
  const result = await client.sendVideoMessage({
    conversationId: 'c1',
    key: 'chat/me/clip.mp4',
    localUri: 'file:///tmp/clip.mp4',
    width: 1280,
    height: 720,
    duration: 8,
    size: 4096,
  });
  assert.equal(sentPayload.type, 'video');
  assert.equal(JSON.stringify(sentPayload.content), JSON.stringify({
    key: 'chat/me/clip.mp4',
    width: 1280,
    height: 720,
    duration: 8,
    size: 4096,
  }));
  assert.equal(sentPayload.content.localUri, undefined);
  assert.equal(result.content.localUri, 'file:///tmp/clip.mp4');
});
