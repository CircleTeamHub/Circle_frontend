const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

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
    throw new Error(`unexpected require: ${request}`);
  });
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
    if (request === './store') {
      return { useChatStore: { getState: () => ({ setConversations: () => {}, ingestMessages: () => {}, upsertConversation: () => {}, removeConversation: () => {} }) } };
    }
    if (request === './protocol') return {};
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
