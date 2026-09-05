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


// 本端删除的消息必须在**每一条**呈现路径上都被挡住,不只是入库。
// 聊天记录的文本/媒体/文件/日期四屏与全局搜索都是直接渲染检索响应、不进 store;
// 前台横幅同理走的是分发器而不是 store。漏掉任何一条,删过的消息就会重现。
function makeContext(extraRequire) {
  const context = {
    Date,
    Math,
    Number,
    URLSearchParams,
    console: { warn: () => {} },
    module: { exports: {} },
    exports: {},
    require: extraRequire,
  };
  context.exports = context.module.exports;
  return context;
}

function runModule(rel, requireFn) {
  const filePath = path.join(process.cwd(), rel);
  const transpiled = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;
  const context = makeContext(requireFn);
  vm.runInNewContext(transpiled, context);
  return context.module.exports;
}

function zustandStub() {
  return {
    create: () => (initializer) => {
      const state = {};
      const set = (partial) => {
        const next = typeof partial === 'function' ? partial(state) : partial;
        Object.assign(state, next);
      };
      Object.assign(state, initializer(set, () => state));
      return { getState: () => state, setState: set };
    },
  };
}

function loadDeleted() {
  return runModule('src/chat-core/deleted-messages.ts', (request) => {
    if (request === 'zustand') return zustandStub();
    if (request === 'zustand/middleware') {
      return {
        persist: (initializer) => initializer,
        createJSONStorage: () => () => ({}),
      };
    }
    if (request === '@/storage') return { mmkvJsonStorage: {} };
    // 超上限时会报一次(墓碑被淘汰=那条消息会复活,必须可观测)。
    if (request === '@/observability/sentry') return { reportError: () => {} };
    if (request === './local-db') return __localDbStub;
    throw new Error(`unexpected require: ${request}`);
  });
}

function loadDateWindow() {
  return runModule(
    'src/features/chat/chat-history-date-window.ts',
    (request) => {
      throw new Error(`unexpected require: ${request}`);
    },
  );
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
  ...over,
});

test('search responses drop locally deleted messages', () => {
  const deleted = loadDeleted();
  const responses = {
    page: { messages: [dto({ id: 'keep' }), dto({ id: 'gone' })], nextBeforeHeight: null },
    flat: [dto({ id: 'keep' }), dto({ id: 'gone' })],
  };
  const api = runModule('src/chat-core/api.ts', (request) => {
    if (request === '@/services/api/client') {
      return {
        apiClient: (url) =>
          Promise.resolve(
            url.includes('/chat/messages/search') ? responses.flat : responses.page,
          ),
      };
    }
    if (request === '@/stores/authStore') {
      return { useAuthStore: { getState: () => ({ sessionEpoch: 1 }) } };
    }
    if (request === './deleted-messages') return deleted;
    if (request === './clear-history-target') {
      return { getKnownClearTargetHeight: () => null };
    }
    if (request === '../features/chat/chat-history-date-window') {
      return loadDateWindow();
    }
    if (request === './store') {
      return { useChatStore: { getState: () => ({ setConversations: () => {}, ingestMessages: () => {}, upsertConversation: () => {}, removeConversation: () => {} }) } };
    }
    if (request === './protocol') return {};
    if (request === './local-db') return __localDbStub;
    throw new Error(`unexpected require: ${request}`);
  });

  deleted.markMessageDeletedLocally('gone');

  return Promise.all([
    api.searchChatMessages('c1', { keyword: 'x' }),
    api.searchAllChatMessages('x'),
  ]).then(([page, flat]) => {
    // 删过的消息在搜索结果里重现,点进去还会跳到一条时间线里没有的目标。
    assert.deepEqual(
      page.messages.map((m) => m.id),
      ['keep'],
    );
    assert.deepEqual(
      flat.map((m) => m.id),
      ['keep'],
    );
  });
});

test('tombstones also match by delivery id', () => {
  const deleted = loadDeleted();
  // 删的是还没确认的气泡:手上只有 local:<d>,而服务端回来的是新 id。
  deleted.markMessageDeletedLocally('local:d-9', 'd-9');
  assert.equal(deleted.isMessageDeletedLocally('server-9', 'd-9'), true);
  assert.equal(deleted.isMessageDeletedLocally('server-9', null), false);
  assert.deepEqual(
    deleted
      .withoutLocallyDeleted([dto({ id: 'server-9', d: 'd-9' }), dto({ id: 'other' })])
      .map((m) => m.id),
    ['other'],
  );
});

function loadApi(deleted, respond) {
  return runModule('src/chat-core/api.ts', (request) => {
    if (request === '@/services/api/client') {
      return { apiClient: (url) => Promise.resolve(respond(url)) };
    }
    if (request === '@/stores/authStore') {
      return { useAuthStore: { getState: () => ({ sessionEpoch: 1 }) } };
    }
    if (request === './deleted-messages') return deleted;
    if (request === './clear-history-target') {
      return { getKnownClearTargetHeight: () => null };
    }
    if (request === '../features/chat/chat-history-date-window') {
      return loadDateWindow();
    }
    if (request === './store') {
      return {
        useChatStore: {
          getState: () => ({
            setConversations: () => {},
            ingestMessages: () => {},
            upsertConversation: () => {},
            removeConversation: () => {},
          }),
        },
      };
    }
    if (request === './protocol') return {};
    if (request === './local-db') return __localDbStub;
    throw new Error(`unexpected require: ${request}`);
  });
}

test('a fully tombstoned page keeps paging instead of showing empty', async () => {
  // nextBeforeHeight 是服务端按**未过滤**的结果给的,所以「本页 0 条 + 游标非空」
  // 完全可能。把空页直接交回去的话,四个历史屏渲染空状态,而继续翻页要靠
  // onEndReached —— 没有内容的列表不会触底,更早的可见结果就永远够不着了。
  const deleted = loadDeleted();
  deleted.markMessageDeletedLocally('gone-1');
  deleted.markMessageDeletedLocally('gone-2');

  const requested = [];
  const api = loadApi(deleted, (url) => {
    requested.push(url);
    if (!url.includes('beforeHeight')) {
      return { messages: [dto({ id: 'gone-1', height: 30 })], nextBeforeHeight: 30 };
    }
    if (url.includes('beforeHeight=30')) {
      return { messages: [dto({ id: 'gone-2', height: 20 })], nextBeforeHeight: 20 };
    }
    return { messages: [dto({ id: 'alive', height: 10 })], nextBeforeHeight: 10 };
  });

  const page = await api.searchChatMessages('c1', { keyword: 'x' });
  assert.deepEqual(
    page.messages.map((m) => m.id),
    ['alive'],
  );
  // 游标必须是最后一次请求的那个,否则下一次翻页会退回已经看过的区间。
  assert.equal(page.nextBeforeHeight, 10);
  assert.equal(requested.length, 3);
});

test('the empty-page chase stops at the end of history', async () => {
  // 游标为 null 就是真的没有更早的了 —— 不能继续追。
  const deleted = loadDeleted();
  deleted.markMessageDeletedLocally('gone-1');
  let calls = 0;
  const api = loadApi(deleted, () => {
    calls += 1;
    return { messages: [dto({ id: 'gone-1' })], nextBeforeHeight: null };
  });

  const page = await api.searchChatMessages('c1', { keyword: 'x' });
  assert.deepEqual(page.messages, []);
  assert.equal(page.nextBeforeHeight, null);
  assert.equal(calls, 1);
});

test('a long tombstoned run still reaches the live hit behind it', async () => {
  // 之前这里设了 5 页上限,但上限只是把死路推远:追满仍空时返回的还是
  // 「空列表 + 活游标」,屏幕照样渲染空态、照样等一个不会来的触底事件。
  const deleted = loadDeleted();
  for (let i = 0; i < 12; i += 1) deleted.markMessageDeletedLocally(`gone-${i}`);
  let calls = 0;
  const api = loadApi(deleted, () => {
    const index = calls;
    calls += 1;
    // 连着 12 页全是墓碑,第 13 页才有活的。
    if (index < 12) {
      return {
        messages: [dto({ id: `gone-${index}` })],
        nextBeforeHeight: 1000 - index,
      };
    }
    return { messages: [dto({ id: 'alive' })], nextBeforeHeight: 500 };
  });

  const page = await api.searchChatMessages('c1', { keyword: 'x' });
  assert.deepEqual(
    page.messages.map((m) => m.id),
    ['alive'],
  );
  assert.equal(calls, 13);
});

test('a cursor that stops advancing ends the chase instead of hanging', async () => {
  // 真正的死循环风险不是页数多,而是服务端返回一个不前进的游标。
  const deleted = loadDeleted();
  deleted.markMessageDeletedLocally('gone');
  let calls = 0;
  const api = loadApi(deleted, () => {
    calls += 1;
    // 永远回同一个游标 —— 不拦的话这里就是无限循环。
    return { messages: [dto({ id: 'gone' })], nextBeforeHeight: 900 };
  });

  const page = await api.searchChatMessages('c1', { beforeHeight: 900 });
  assert.deepEqual(page.messages, []);
  assert.equal(calls, 1);
});
