const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// 会话快照的「新鲜度」。loadChatConversations 默认把同一账号的并发请求合并成
// 一个;但会话元信息刚变更时(群公告/头像/群主、陌生会话的第一条消息),在途的
// 那次请求可能发在服务端落库之前 —— 复用它,拿回来的就是变更前的旧快照。

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

function runModule(rel, requireFn) {
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
  };
  context.exports = context.module.exports;
  vm.runInNewContext(code, context, { filename: filePath });
  return context.module.exports;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function loadDateWindow() {
  return runModule('src/features/chat/chat-history-date-window.ts', (request) => {
    throw new Error(`unexpected require: ${request}`);
  });
}

/**
 * 每次真正发出的 GET 都挂一个手动控制的 deferred:测试决定它何时、以什么结果
 * 回来。snapshots 按落地顺序记下写进 store 的快照。
 */
function loadApi() {
  const calls = [];
  const snapshots = [];
  const api = runModule('src/chat-core/api.ts', (request) => {
    if (request === '@/services/api/client') {
      return {
        apiClient: (url) => {
          const call = deferred();
          calls.push({ url, resolve: call.resolve, reject: call.reject });
          return call.promise;
        },
      };
    }
    if (request === '@/utils/retry') return { retry: (operation) => operation() };
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
      return { getKnownClearTargetHeight: () => undefined };
    }
    if (request === '../features/chat/chat-history-date-window') return loadDateWindow();
    if (request === './store') {
      return {
        useChatStore: {
          getState: () => ({
            setConversations: (conversations) => snapshots.push(conversations),
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
  return { api, calls, snapshots };
}

/** 让在途 Promise 链上所有能跑的微任务都跑完。 */
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('并发的普通会话列表请求仍然合并成一次', async () => {
  const { api, calls } = loadApi();

  const first = api.loadChatConversations();
  const second = api.loadChatConversations();
  await settle();
  assert.equal(calls.length, 1);

  const list = [{ id: 'c1' }];
  calls[0].resolve(list);
  assert.equal(await first, list);
  assert.equal(await second, list);
});

test('要新快照时不复用变更之前就在途的请求', async () => {
  const { api, calls, snapshots } = loadApi();

  const stale = api.loadChatConversations();
  await settle();
  const fresh = api.loadChatConversations({ fresh: true });
  await settle();
  // 旧请求回来之前不发第二发:两发并行时先发后到的旧响应会把新快照覆盖掉。
  assert.equal(calls.length, 1);

  const before = [{ id: 'c1', notice: '旧公告' }];
  const after = [{ id: 'c1', notice: '新公告' }];
  calls[0].resolve(before);
  await settle();
  assert.equal(calls.length, 2, 'fresh load must issue its own request');
  calls[1].resolve(after);

  assert.equal(await stale, before);
  assert.equal(await fresh, after);
  // 落地顺序:旧快照先、新快照后,store 最终停在新值上。
  assert.deepEqual(
    snapshots.map((list) => list[0].notice),
    ['旧公告', '新公告'],
  );
});

test('在途请求失败不连累随后的新快照请求', async () => {
  const { api, calls } = loadApi();

  const stale = api.loadChatConversations();
  await settle();
  const fresh = api.loadChatConversations({ fresh: true });

  calls[0].reject(new Error('network down'));
  await assert.rejects(stale, /network down/);
  await settle();
  assert.equal(calls.length, 2);

  const list = [{ id: 'c1' }];
  calls[1].resolve(list);
  assert.equal(await fresh, list);
});

test('没有在途请求时新快照请求立即发出', async () => {
  const { api, calls } = loadApi();

  const fresh = api.loadChatConversations({ fresh: true });
  await settle();
  assert.equal(calls.length, 1);

  const list = [];
  calls[0].resolve(list);
  assert.equal(await fresh, list);
});

test('新快照请求挂起期间的普通请求合并到它上面', async () => {
  const { api, calls } = loadApi();

  const stale = api.loadChatConversations();
  await settle();
  const fresh = api.loadChatConversations({ fresh: true });
  const joiner = api.loadChatConversations();

  calls[0].resolve([{ id: 'old' }]);
  await stale;
  await settle();
  const latest = [{ id: 'new' }];
  calls[1].resolve(latest);

  assert.equal(await fresh, latest);
  assert.equal(await joiner, latest);
  assert.equal(calls.length, 2);
});
