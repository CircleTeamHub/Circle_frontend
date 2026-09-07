const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const localDbStub = {
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
  return {
    filePath,
    code: ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
      fileName: filePath,
    }).outputText,
  };
}

function runModule(rel, requireFn, extraGlobals = {}) {
  const { filePath, code } = transpile(rel);
  const context = {
    Date,
    Math,
    Number,
    URLSearchParams,
    Promise,
    console: { warn: () => {} },
    module: { exports: {} },
    exports: {},
    require: requireFn,
    ...extraGlobals,
  };
  context.exports = context.module.exports;
  vm.runInNewContext(code, context, { filename: filePath });
  return context.module.exports;
}

const dto = (over = {}) => ({
  id: 'm1',
  conversationId: 'c1',
  height: 1,
  type: 'text',
  content: { text: 'hi' },
  sender: { id: 'peer', nickname: '他', avatarUrl: null },
  replyToId: null,
  d: null,
  createdAt: '2026-01-01T00:00:00.000Z',
});

function loadDateWindow() {
  return runModule('src/features/chat/chat-history-date-window.ts', (request) => {
    throw new Error(`unexpected require: ${request}`);
  });
}

function loadApi({ respond, clearTargetHeight = () => undefined }) {
  return runModule('src/chat-core/api.ts', (request) => {
    if (request === '@/services/api/client') {
      return { apiClient: (url, init) => Promise.resolve(respond(url, init)) };
    }
    if (request === '@/stores/authStore') {
      return { useAuthStore: { getState: () => ({ sessionEpoch: 1 }) } };
    }
    if (request === './deleted-messages') {
      return {
        withoutLocallyDeleted: (messages) => messages,
        isMessageDeletedLocally: () => false,
        markMessageDeletedLocally: () => {},
      };
    }
    if (request === './clear-history-target') {
      return { getKnownClearTargetHeight: clearTargetHeight };
    }
    if (request === '../features/chat/chat-history-date-window') return loadDateWindow();
    if (request === './store') {
      return {
        useChatStore: {
          getState: () => ({
            setConversations: () => {},
            ingestMessages: () => {},
            upsertConversation: () => {},
            removeConversation: () => {},
            clearConversationLocal: () => {},
            conversations: [],
            messagesByConversation: {},
          }),
        },
      };
    }
    if (request === './protocol') return {};
    if (request === './local-db') return localDbStub;
    throw new Error(`unexpected require: ${request}`);
  });
}

// 六个历史列表屏(文本 / 媒体 / 文件 / 日期结果 / 群日志,首页与翻页各一条路径)
// 都写成 `setHasMore(page.nextBeforeHeight !== null)`。所以「游标停住了」这件事
// 必须由产出游标的地方归一成 null —— 原样交出去,hasMore 就永远为真,用户每滑一下
// 就发一次一模一样的请求,列表一行都不涨,而且不会停。
test('搜索翻页把不前进的游标归一成「到头了」', async () => {
  let calls = 0;
  const api = loadApi({
    respond: () => {
      calls += 1;
      // 服务端一直回同一个游标。
      return { messages: [dto()], nextBeforeHeight: 900 };
    },
  });

  const page = await api.searchChatMessages('c1', { beforeHeight: 900 });

  assert.equal(calls, 1);
  assert.equal(page.nextBeforeHeight, null);
});

test('翻页游标退回更晚的位置同样按到头处理', async () => {
  const api = loadApi({
    respond: () => ({ messages: [dto()], nextBeforeHeight: 950 }),
  });

  const page = await api.searchChatMessages('c1', { beforeHeight: 900 });

  assert.equal(page.nextBeforeHeight, null);
});

test('正常前进的游标原样交给调用方', async () => {
  const api = loadApi({
    respond: () => ({ messages: [dto()], nextBeforeHeight: 800 }),
  });

  const page = await api.searchChatMessages('c1', { beforeHeight: 900 });

  assert.equal(page.nextBeforeHeight, 800);
});

test('首页没有 beforeHeight 时任何非空游标都算前进', async () => {
  const api = loadApi({
    respond: () => ({ messages: [dto()], nextBeforeHeight: 900 }),
  });

  const page = await api.searchChatMessages('c1', {});

  assert.equal(page.nextBeforeHeight, 900);
});

// 这张去重表的用途是「同一次点击的并发去重」。原来只在成功路径上删,一次失败就把
// 当时的 targetHeight 钉在表里直到换账号 —— 用户过几分钟重试,清的还是那个旧水位,
// 这中间收到的消息一条不清,而界面照样提示「已清空」。
test('清空失败后重试会重新取当前水位，而不是复用失败那次的', async () => {
  let heightNow = 10;
  let shouldFail = true;
  const bodies = [];
  const api = loadApi({
    clearTargetHeight: () => heightNow,
    respond: (url, init) => {
      if (!url.includes('/clear')) return {};
      bodies.push(init.body);
      if (shouldFail) throw new Error('offline');
      return { clearedBeforeHeight: heightNow };
    },
  });

  await assert.rejects(() => api.clearChatConversationHistory('c1'));

  // 失败之后又收到了新消息。
  heightNow = 42;
  shouldFail = false;
  await api.clearChatConversationHistory('c1');

  assert.deepEqual(
    bodies.map((body) => body.targetHeight),
    [10, 42],
  );
});

test('同一次点击的并发清空仍然只算一个水位', async () => {
  let heightNow = 10;
  const bodies = [];
  const api = loadApi({
    clearTargetHeight: () => heightNow,
    respond: (url, init) => {
      if (!url.includes('/clear')) return {};
      bodies.push(init.body);
      heightNow += 5;
      return { clearedBeforeHeight: 10 };
    },
  });

  await Promise.all([
    api.clearChatConversationHistory('c1'),
    api.clearChatConversationHistory('c1'),
  ]);

  assert.deepEqual(
    bodies.map((body) => body.targetHeight),
    [10, 10],
  );
});

function loadClient({ pages }) {
  let index = 0;
  const requested = [];
  const api = runModule('src/chat-core/client.ts', (request) => {
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
        loadChatHistory: async (conversationId, options = {}) => {
          requested.push(options.beforeHeight ?? null);
          const page = pages[Math.min(index, pages.length - 1)];
          index += 1;
          return page;
        },
        backfillConversationSince: async () => {},
      };
    }
    if (request === './socket-manager') {
      return {
        ChatSendError: class extends Error {},
        createDeliveryId: () => 'd-test',
        markConversationRead: () => {},
        sendChatMessage: async () => ({ messageId: 'm1', height: 1 }),
      };
    }
    if (request === './store') {
      return {
        useChatStore: {
          getState: () => ({
            ingestMessages: () => {},
            applyIncomingMessage: () => true,
            markMessageFailed: () => {},
            markMessageRetrying: () => {},
            removeMessage: () => {},
            revertConversationPreview: () => {},
            upsertConversation: () => {},
            messagesByConversation: {},
            conversations: [],
          }),
        },
      };
    }
    if (request === './send-errors') return { reportChatSendFailure: () => {} };
    if (request === './protocol') {
      return runModule('src/chat-core/protocol.ts', () => {
        throw new Error('protocol should have no runtime deps');
      });
    }
    if (request === './local-db') return localDbStub;
    throw new Error(`unexpected require: ${request}`);
  });
  return { api, requested };
}

// 会话时间线自己的游标也一样。停住的游标照原样存回去，hasMoreHistory 就永远为真：
// 用户每次触顶都发一次一模一样的请求，一条更早的消息也翻不出来。
test('会话时间线不前进的游标同样收手', async () => {
  const { api, requested } = loadClient({
    pages: [
      { messages: [], nextBeforeHeight: 900 },
      { messages: [], nextBeforeHeight: 900 },
    ],
  });

  await api.loadConversationMessages('c1');
  assert.equal(api.hasMoreHistory('c1'), true);

  await api.loadOlderConversationMessages('c1');

  assert.equal(api.hasMoreHistory('c1'), false);
  // 再触底也不再发请求。
  await api.loadOlderConversationMessages('c1');
  assert.deepEqual(requested, [null, 900]);
});

test('会话时间线正常前进时继续可翻', async () => {
  const { api, requested } = loadClient({
    pages: [
      { messages: [], nextBeforeHeight: 900 },
      { messages: [], nextBeforeHeight: 800 },
      { messages: [], nextBeforeHeight: null },
    ],
  });

  await api.loadConversationMessages('c1');
  await api.loadOlderConversationMessages('c1');
  assert.equal(api.hasMoreHistory('c1'), true);

  await api.loadOlderConversationMessages('c1');
  assert.equal(api.hasMoreHistory('c1'), false);
  assert.deepEqual(requested, [null, 900, 800]);
});
