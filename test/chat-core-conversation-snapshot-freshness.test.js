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
function loadPagination() {
  return runModule('src/services/api/pagination.ts', (request) => {
    throw new Error(`unexpected require: ${request}`);
  });
}

function headersOf(values) {
  return { get: (name) => values[name] ?? null };
}

/** 让某次 GET 带着响应头回来(真实 apiClient 在 resolve 之前回调 onResponseHeaders)。 */
function respond(call, data, headers = {}) {
  call.options?.onResponseHeaders?.(headersOf(headers));
  call.resolve(data);
}

async function flush() {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

function loadApi(options = {}) {
  const calls = [];
  const reported = [];
  const snapshots = [];
  const snapshotRevisions = [];
  const burnUpdates = [];
  const state = { conversationPreviewRevision: 0, epoch: 1 };
  const ingested = [];
  const localReads = [];
  const merged = [];
  const api = runModule('src/chat-core/api.ts', (request) => {
    if (request === '@/services/api/client') {
      return {
        apiClient: (url, requestOptions) => {
          const call = deferred();
          calls.push({
            url,
            options: requestOptions,
            resolve: call.resolve,
            reject: call.reject,
          });
          return call.promise;
        },
      };
    }
    if (request === '@/services/api/pagination') return loadPagination();
    if (request === '@/observability/report-failure') {
      return { reportHandledFailure: (...args) => reported.push(args) };
    }
    if (request === '@/utils/retry') return { retry: options.retry ?? ((operation) => operation()) };
    if (request === '@/stores/authStore') {
      return { useAuthStore: { getState: () => ({ sessionEpoch: state.epoch }) } };
    }
    if (request === './deleted-messages') {
      return {
        withoutLocallyDeleted: (messages) => messages,
        isMessageDeletedLocally: (id) => (options.deletedIds ?? []).includes(id),
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
            conversationPreviewRevision: state.conversationPreviewRevision,
            mergeConversationSnapshot: (conversation, revision) => {
              merged.push({ conversation, revision });
            },
            setConversations: (conversations, revision) => {
              snapshots.push(conversations);
              snapshotRevisions.push(revision);
            },
            applyBurnDuration: (...args) => burnUpdates.push(args),
            ingestMessages: (conversationId, messages, ingestOptions) => {
              ingested.push({ conversationId, messages, options: ingestOptions });
              return Promise.resolve(true);
            },
            conversationsSnapshotLoaded: state.snapshotLoaded ?? true,
            upsertConversation: () => {},
            removeConversation: () => {},
            clearConversationLocal: () => {},
            conversations: [],
            messagesByConversation: options.memory ?? {},
            currentUserId: 'u1',
            connected: state.connected ?? true,
          }),
        },
        conversationsLeftSince: () => new Set(),
        // 与真实 store 同口径的简化排序:置顶优先,再按末条时间倒序。
        sortConversations: (items) =>
          [...items].sort((a, b) => {
            if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
            return String(b.lastMessageAt ?? '').localeCompare(String(a.lastMessageAt ?? ''));
          }),
      };
    }
    if (request === './protocol') return {};
    if (request === './local-db') {
      return {
        ...localDbStub,
        readRecentLocalMessages: async (conversationId) => {
          localReads.push(conversationId);
          return options.localRows?.[conversationId] ?? [];
        },
      };
    }
    throw new Error(`unexpected require: ${request}`);
  });
  return { api, calls, snapshots, snapshotRevisions, burnUpdates, state, reported, ingested, localReads, merged };
}

/** 让在途 Promise 链上所有能跑的微任务都跑完。 */
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('会话快照请求使用服务端允许的最大窗口，避免默认只取前 100 条', async () => {
  const { api, calls } = loadApi();

  const request = api.loadChatConversations();
  await settle();

  assert.equal(calls[0].url, '/chat/conversations?limit=500');
  calls[0].resolve([]);
  await request;
});

test('阅后即焚回执把服务端持久化的开启边界写入 store', async () => {
  const { api, calls, burnUpdates } = loadApi();
  const startedAt = '2026-09-14T20:00:00.000Z';

  const request = api.setChatBurnDuration('c1', 60);
  await settle();
  calls[0].resolve({ burnDurationSec: 60, burnStartedAt: startedAt });

  assert.equal(await request, 60);
  assert.deepEqual(burnUpdates, [['c1', 60, startedAt]]);
});

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

test('preview revisions are captured when a queued fresh request actually starts', async () => {
  const { api, calls, state, snapshotRevisions } = loadApi();
  state.conversationPreviewRevision = 3;
  const stale = api.loadChatConversations();
  const fresh = api.loadChatConversations({ fresh: true });
  state.conversationPreviewRevision = 4;

  calls[0].resolve([]);
  await stale;
  await settle();
  state.conversationPreviewRevision = 5;
  calls[1].resolve([]);
  await fresh;

  assert.deepEqual(snapshotRevisions, [3, 4]);
});

test('each snapshot retry captures a new preview revision before its GET', async () => {
  const { api, calls, state, snapshotRevisions } = loadApi({
    retry: async (operation) => {
      try { return await operation(); } catch { return operation(); }
    },
  });
  state.conversationPreviewRevision = 1;
  const request = api.loadChatConversations();
  state.conversationPreviewRevision = 2;
  calls[0].reject(new Error('network down'));
  await settle();
  state.conversationPreviewRevision = 3;
  calls[1].resolve([]);
  await request;

  assert.deepEqual(snapshotRevisions, [2]);
});

// 群很多的用户:第一页被截断(X-Has-More: true)时按会话 id 键集游标取齐,
// 否则超过 500 的会话会从列表里彻底消失。
test('a truncated first page is completed by walking the keyset cursor', async () => {
  const { api, calls, snapshots } = loadApi();
  const request = api.loadChatConversations();

  respond(calls[0], [{ id: 'recent-1' }, { id: 'recent-2' }], { 'X-Has-More': 'true' });
  await flush();
  assert.equal(calls[1].url, '/chat/conversations?limit=500&cursor=');
  respond(calls[1], [{ id: 'a' }, { id: 'b' }], { 'X-Has-More': 'true', 'X-Next-Cursor': 'b' });
  await flush();
  assert.equal(calls[2].url, '/chat/conversations?limit=500&cursor=b');
  respond(calls[2], [{ id: 'c' }], { 'X-Has-More': 'false' });

  await request;
  // 快照数组由 vm 里的分页模块拼出,跨上下文原型不同,先转成本上下文数组再比。
  assert.deepEqual(Array.from(snapshots.at(-1), (c) => c.id), ['a', 'b', 'c']);
});

test('an untruncated first page is used as is, with a single request', async () => {
  const { api, calls, snapshots } = loadApi();
  const request = api.loadChatConversations();
  respond(calls[0], [{ id: 'a' }], { 'X-Has-More': 'false' });
  await request;
  assert.equal(calls.length, 1);
  assert.deepEqual(snapshots.at(-1).map((c) => c.id), ['a']);
});

test('an old server that rejects the cursor keeps the first page, without reporting', async () => {
  const { api, calls, snapshots, reported } = loadApi();
  const request = api.loadChatConversations();
  respond(calls[0], [{ id: 'recent-1' }], { 'X-Has-More': 'true' });
  await flush();
  calls[1].reject(Object.assign(new Error('Bad Request'), { status: 400 }));
  await request;
  assert.deepEqual(snapshots.at(-1).map((c) => c.id), ['recent-1']);
  assert.equal(reported.length, 0);
});

test('a server that ignores the cursor (no next cursor yet "has more") keeps the first page', async () => {
  const { api, calls, snapshots } = loadApi();
  const request = api.loadChatConversations();
  respond(calls[0], [{ id: 'recent-1' }], { 'X-Has-More': 'true' });
  await flush();
  respond(calls[1], [{ id: 'recent-1' }], { 'X-Has-More': 'true' });
  await request;
  assert.deepEqual(snapshots.at(-1).map((c) => c.id), ['recent-1']);
});

test('a failure while paging rejects instead of replacing the list with a truncated page', async () => {
  // 500 个以上会话的用户碰上一次 429/网络抖动:拿第一页整表替换,500 以后的会话就从
  // 列表和角标里消失,还被当成「刚拉过」挡掉 30 秒内的重拉。
  const { api, calls, snapshots, reported } = loadApi();
  const request = api.loadChatConversations();
  respond(calls[0], [{ id: 'recent-1' }], { 'X-Has-More': 'true' });
  await flush();
  calls[1].reject(Object.assign(new Error('Too Many Requests'), { status: 429 }));
  await assert.rejects(request);
  assert.equal(snapshots.length, 0);
  assert.equal(api.canSkipConversationFocusReload(), false);
  assert.equal(reported.length, 0);
});

test('focus reloads are skipped right after a full snapshot while connected', async () => {
  const { api, calls, state } = loadApi();
  assert.equal(api.canSkipConversationFocusReload(), false);

  const request = api.loadChatConversations();
  respond(calls[0], [{ id: 'a' }], { 'X-Has-More': 'false' });
  await request;
  assert.equal(api.canSkipConversationFocusReload(), true);
  // 窗口过了就要重拉。
  assert.equal(api.isConversationSnapshotFresh(30_000, Date.now() + 31_000), false);

  // 实时连接断了:会话变化收不到推送,回到页面必须重拉。
  state.connected = false;
  assert.equal(api.canSkipConversationFocusReload(), false);
});

test('a failed load does not count as a fresh snapshot', async () => {
  const { api, calls } = loadApi();
  const request = api.loadChatConversations();
  calls[0].reject(Object.assign(new Error('boom'), { status: 500 }));
  await assert.rejects(request);
  assert.equal(api.canSkipConversationFocusReload(), false);
});

test('once the cursor is known to work, later loads walk it directly', async () => {
  const { api, calls } = loadApi();
  const first = api.loadChatConversations();
  respond(calls[0], [{ id: 'r' }], { 'X-Has-More': 'true' });
  await flush();
  respond(calls[1], [{ id: 'a' }], { 'X-Has-More': 'false' });
  await first;

  const second = api.loadChatConversations({ fresh: true });
  await flush();
  // 省掉那一发会被丢弃的旧模式第一页。
  assert.equal(calls[2].url, '/chat/conversations?limit=500&cursor=');
  respond(calls[2], [{ id: 'a' }], { 'X-Has-More': 'false' });
  await second;
  assert.equal(calls.length, 3);
});

test('an old server is not probed with the cursor again in the same session', async () => {
  const { api, calls } = loadApi();
  const first = api.loadChatConversations();
  respond(calls[0], [{ id: 'r' }], { 'X-Has-More': 'true' });
  await flush();
  calls[1].reject(Object.assign(new Error('Bad Request'), { status: 400 }));
  await first;

  const second = api.loadChatConversations({ fresh: true });
  await flush();
  respond(calls[2], [{ id: 'r' }], { 'X-Has-More': 'true' });
  await second;
  assert.equal(calls.length, 3);
  assert.equal(calls[2].url, '/chat/conversations?limit=500');
});

test('a walked snapshot comes back in activity order, not id order', async () => {
  // 增量同步按返回顺序排队:最近的会话要先追平。
  const { api, calls } = loadApi();
  const request = api.loadChatConversations();
  respond(calls[0], [{ id: 'r' }], { 'X-Has-More': 'true' });
  await flush();
  respond(
    calls[1],
    [
      { id: 'a', lastMessageAt: '2026-01-01T00:00:00.000Z' },
      { id: 'b', lastMessageAt: '2026-10-01T00:00:00.000Z' },
    ],
    { 'X-Has-More': 'false' },
  );
  const result = await request;
  assert.deepEqual(Array.from(result, (c) => c.id), ['b', 'a']);
});

test('switching accounts mid-walk stops paging with the old cursor', async () => {
  const { api, calls, state, snapshots } = loadApi();
  const request = api.loadChatConversations();
  respond(calls[0], [{ id: 'r' }], { 'X-Has-More': 'true' });
  await flush();
  respond(calls[1], [{ id: 'a' }], { 'X-Has-More': 'true', 'X-Next-Cursor': 'a' });
  state.epoch = 2;
  await request.catch(() => undefined);
  assert.equal(calls.length, 2);
  assert.equal(snapshots.length, 0);
});

test('focus reloads are not skipped over a partial store or a different account', async () => {
  const { api, calls, state } = loadApi();
  const request = api.loadChatConversations();
  respond(calls[0], [{ id: 'a' }], { 'X-Has-More': 'false' });
  await request;
  assert.equal(api.canSkipConversationFocusReload(), true);

  // 「清空所有聊天」之后 store 被清成残缺状态。
  state.snapshotLoaded = false;
  assert.equal(api.canSkipConversationFocusReload(), false);
  state.snapshotLoaded = true;

  state.epoch = 2;
  assert.equal(api.canSkipConversationFocusReload(), false);
  state.epoch = 1;

  // 时钟回拨:差值为负,不当作新鲜。
  assert.equal(api.isConversationSnapshotFresh(30_000, Date.now() - 60_000), false);
});

test('a conversation whose last message was deleted here gets its local timeline before the snapshot lands', async () => {
  // 服务端不知道本机的删除墓碑,快照末条还是那条;没预读过的会话得先读本地时间线,
  // 预览才能回退到上一条而不是变成空白。
  const { api, calls, localReads, ingested, snapshots } = loadApi({
    deletedIds: ['m-deleted'],
    localRows: { 'conv-x': [{ id: 'm-prev', height: 4 }] },
  });
  const request = api.loadChatConversations();
  respond(
    calls[0],
    [
      { id: 'conv-x', lastMessage: { id: 'm-deleted', d: null } },
      { id: 'conv-y', lastMessage: { id: 'm-ok', d: null } },
    ],
    { 'X-Has-More': 'false' },
  );
  await request;
  assert.deepEqual(localReads, ['conv-x']);
  assert.equal(ingested.length, 1);
  assert.equal(ingested[0].conversationId, 'conv-x');
  assert.equal(ingested[0].options.persist, false);
  assert.equal(snapshots.length, 1);
});

test('opening a conversation reads its local cache even if a live message already sits in memory', async () => {
  // 冷启动没预读的会话收到一条实时消息后,内存里就有了这一条;原来按「内存为空」判断,
  // 打开时就跳过本地库 —— 离线时整个会话只剩这一条。
  const { api, calls, localReads, ingested } = loadApi({
    memory: { 'conv-z': [{ id: 'live', height: 10 }] },
    localRows: { 'conv-z': [{ id: 'old-3', height: 3 }, { id: 'old-4', height: 4 }] },
  });
  const history = api.loadChatHistory('conv-z');
  await flush();
  assert.deepEqual(localReads, ['conv-z']);
  assert.deepEqual(
    Array.from(ingested[0].messages, (m) => m.id),
    ['old-3', 'old-4'],
  );
  respond(calls[0], { messages: [{ id: 'old-4', height: 4 }, { id: 'live', height: 10 }] });
  await history.catch(() => undefined);

  // 第二次打开不再重复读本地库。
  const again = api.loadChatHistory('conv-z');
  await flush();
  assert.deepEqual(localReads, ['conv-z']);
  respond(calls.at(-1), { messages: [] });
  await again.catch(() => undefined);
});

test('expired burn messages read from the local cache are not shown', async () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  const future = new Date(Date.now() + 60_000).toISOString();
  const { api, calls, ingested } = loadApi({
    localRows: {
      'conv-b': [
        { id: 'expired', height: 1, burnExpiresAt: past },
        { id: 'alive', height: 2, burnExpiresAt: future },
        { id: 'plain', height: 3 },
      ],
    },
  });
  const history = api.loadChatHistory('conv-b');
  await flush();
  assert.deepEqual(Array.from(ingested[0].messages, (m) => m.id), ['alive', 'plain']);
  respond(calls[0], { messages: [] });
  await history.catch(() => undefined);
});

test('refreshing one conversation fetches just that row and merges it with the request revision', async () => {
  const { api, calls, merged, snapshots, state } = loadApi();
  state.conversationPreviewRevision = 7;
  const request = api.refreshChatConversation('conv-1');
  assert.equal(calls[0].url, '/chat/conversations/conv-1');
  respond(calls[0], { id: 'conv-1', muted: true });
  await request;
  assert.equal(merged.length, 1);
  assert.equal(merged[0].conversation.id, 'conv-1');
  assert.equal(merged[0].revision, 7);
  // 不是整表快照:不能走 setConversations。
  assert.equal(snapshots.length, 0);
});

test('a failed single refresh rejects so the caller can fall back to the full list', async () => {
  const { api, calls, merged } = loadApi();
  const request = api.refreshChatConversation('conv-1');
  calls[0].reject(Object.assign(new Error('Not Found'), { status: 404 }));
  await assert.rejects(request);
  assert.equal(merged.length, 0);
});

test('a page that needs the whole list reuses a fresh snapshot instead of refetching', async () => {
  const { api, calls, state } = loadApi();
  const load = api.loadChatConversations();
  respond(calls[0], [{ id: 'a' }], { 'X-Has-More': 'false' });
  await load;

  await api.ensureChatConversations();
  assert.equal(calls.length, 1, 'fresh snapshot while connected: no second request');

  // 实时连接断了:会话变化收不到推送,必须重新拉。
  state.connected = false;
  const reload = api.ensureChatConversations();
  assert.equal(calls.length, 2);
  respond(calls[1], [{ id: 'a' }], { 'X-Has-More': 'false' });
  await reload;
});

test('a page that needs one conversation fetches just it, and falls back to the list on failure', async () => {
  const { api, calls } = loadApi();
  const single = api.refreshConversationOrList('conv-1');
  assert.equal(calls[0].url, '/chat/conversations/conv-1');
  respond(calls[0], { id: 'conv-1' });
  await single;
  assert.equal(calls.length, 1);

  // 老服务端没有单个会话接口:退回整表。
  const fallback = api.refreshConversationOrList('conv-1');
  calls[1].reject(Object.assign(new Error('Not Found'), { status: 404 }));
  await flush();
  assert.equal(calls[2].url, '/chat/conversations?limit=500');
  respond(calls[2], [{ id: 'conv-1' }], { 'X-Has-More': 'false' });
  await fallback;
});

test('a single refresh waits for an in-flight full reload so the older snapshot cannot overwrite it', async () => {
  // 整表请求发在变更之前、却晚于单个刷新落地的话,会拿旧状态盖掉刚合并的这一行。
  const { api, calls, merged, snapshots } = loadApi();
  const full = api.loadChatConversations();
  const single = api.refreshChatConversation('conv-1');
  await flush();
  assert.equal(calls.length, 1, 'the single GET waits for the in-flight full reload');

  respond(calls[0], [{ id: 'conv-1', muted: false }], { 'X-Has-More': 'false' });
  await full;
  await flush();
  assert.equal(calls[1].url, '/chat/conversations/conv-1');
  respond(calls[1], { id: 'conv-1', muted: true });
  await single;
  assert.equal(snapshots.length, 1);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].conversation.muted, true);
});

test('a single refresh rejects a body that is not the requested conversation', async () => {
  const { api, calls, merged } = loadApi();
  const single = api.refreshChatConversation('conv-1');
  respond(calls[0], [{ id: 'conv-1' }]);
  await assert.rejects(single);
  assert.equal(merged.length, 0);
});

test('an old server without the endpoint is not asked again in the same session', async () => {
  const { api, calls } = loadApi();
  const first = api.refreshChatConversation('conv-1');
  calls[0].reject(Object.assign(new Error('Cannot GET'), { status: 404 }));
  await assert.rejects(first);

  await assert.rejects(api.refreshChatConversation('conv-2'));
  assert.equal(calls.length, 1, 'no second request after a route-missing 404');
});

test('a "gone" 404 does not mark the endpoint as unsupported', async () => {
  const { api, calls } = loadApi();
  const first = api.refreshChatConversation('hidden');
  calls[0].reject(
    Object.assign(new Error('gone'), { status: 404, errorCode: 'CHAT_CONVERSATION_NOT_FOUND' }),
  );
  await assert.rejects(first);
  const second = api.refreshChatConversation('conv-2');
  assert.equal(calls.length, 2);
  respond(calls[1], { id: 'conv-2' });
  await second;
});

test('a single refresh that lands after an account switch is dropped', async () => {
  const { api, calls, merged, state } = loadApi();
  const single = api.refreshChatConversation('conv-1');
  state.epoch = 2;
  respond(calls[0], { id: 'conv-1' });
  await single;
  assert.equal(merged.length, 0);
});

test('a single refresh reads the local timeline behind a locally deleted preview first', async () => {
  const { api, calls, localReads, ingested, merged } = loadApi({
    deletedIds: ['m-deleted'],
    localRows: { 'conv-1': [{ id: 'm-prev', height: 4 }] },
  });
  const single = api.refreshChatConversation('conv-1');
  respond(calls[0], { id: 'conv-1', lastMessage: { id: 'm-deleted', d: null } });
  await single;
  assert.deepEqual(localReads, ['conv-1']);
  assert.equal(ingested.length, 1);
  assert.equal(merged.length, 1);
});
