const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

/**
 * 媒体重发的并发合流(codex review)。
 *
 * 失败气泡长按「重发」会重跑整条「presign + 上传 + 发送」。重发期间气泡原样
 * 红着、mediaRetries 里的闭包也还在 —— 用户多按几下就是多跑几遍上传:重复
 * 拿签名、把同一份原图和缩略图再传一遍,存储上留下没人引用的对象。复用同一个
 * deliveryId 只能让最后那条聊天消息不重复,拦不住上传本身。
 */

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

function loadStack({ onSend = async () => ({ messageId: 'srv-1', height: 9 }) } = {}) {
  const store = runModule('src/chat-core/store.ts', (request) => {
    if (request === 'zustand') return zustandStub();
    if (request === './protocol')
      return runModule('src/chat-core/protocol.ts', () => {
        throw new Error('protocol should have no runtime deps');
      });
    if (request === './local-db') return __localDbStub;
    if (request === './deleted-messages') {
      return {
        isMessageDeletedLocally: () => false,
        markMessageDeletedLocally: () => {},
      };
    }
    if (request === '@/storage') {
      return { storage: { set: () => {}, getString: () => undefined } };
    }
    throw new Error(`unexpected require: ${request}`);
  });

  const client = runModule('src/chat-core/client.ts', (request) => {
    if (request === '@/services/api/credit-policy')
      return { assertLocalCanSendMessage: () => {} };
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
    if (request === './protocol')
      return runModule('src/chat-core/protocol.ts', () => {
        throw new Error('protocol should have no runtime deps');
      });
    if (request === './local-db') return __localDbStub;
    throw new Error(`unexpected require: ${request}`);
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
  return { client, store };
}

const bubble = (store, d) =>
  (store.useChatStore.getState().messagesByConversation['c1'] ?? []).find(
    (m) => m.d === d,
  );

test('并发重发只跑一次上传', async () => {
  const { client, store } = loadStack();
  let uploads = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  const d = client.startMediaSend({
    conversationId: 'c1',
    type: 'image',
    localContent: { localUri: 'file:///a.jpg' },
    retry: async () => {
      uploads += 1;
      await gate;
    },
  });
  client.failMediaSend('c1', d);
  assert.equal(bubble(store, d).failed, true);

  // 用户连按三下「重发」——上传只该跑一遍。
  const attempts = [
    client.retryFailedChatMessage('c1', d),
    client.retryFailedChatMessage('c1', d),
    client.retryFailedChatMessage('c1', d),
  ];
  assert.equal(uploads, 1);

  release();
  await Promise.all(attempts);

  // 重发跑完后锁要放开,否则这条气泡再也重发不了。
  const again = client.retryFailedChatMessage('c1', d);
  assert.equal(uploads, 2);
  await again;
});

test('重发期间气泡回到「发送中」,重发菜单项随之消失', async () => {
  const { client, store } = loadStack();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  const d = client.startMediaSend({
    conversationId: 'c1',
    type: 'voice',
    localContent: { localUri: 'file:///a.m4a', duration: 3 },
    retry: async () => {
      await gate;
    },
  });
  client.failMediaSend('c1', d);

  const attempt = client.retryFailedChatMessage('c1', d);
  // sendStatus 由 height/failed 推导(message-mappers):failed 清掉即回到「发送中」,
  // 长按菜单里的「重发」只在 sendStatus===3 时出现 —— 连点的入口本身就没了。
  assert.equal(bubble(store, d).failed, undefined);

  release();
  await attempt;
});

test('重发再次失败 → 气泡重新标红,还能再发', async () => {
  const { client, store } = loadStack();
  let uploads = 0;

  const d = client.startMediaSend({
    conversationId: 'c1',
    type: 'image',
    localContent: { localUri: 'file:///a.jpg' },
    // 上传路径自己 catch 后调 failMediaSend(不抛),照真实调用方的形状写。
    retry: async (deliveryId) => {
      uploads += 1;
      client.failMediaSend('c1', deliveryId);
    },
  });
  client.failMediaSend('c1', d);

  await client.retryFailedChatMessage('c1', d);
  assert.equal(uploads, 1);
  assert.equal(bubble(store, d).failed, true);

  await client.retryFailedChatMessage('c1', d);
  assert.equal(uploads, 2);
  assert.equal(bubble(store, d).failed, true);
});
