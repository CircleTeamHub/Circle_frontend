const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { withObservabilityStubs } = require('./helpers/observability-stubs');

/**
 * 会话变更序号流的客户端协调器(src/chat-core/sync.ts)。
 *
 * 决策本身(追/采纳/跳、缺口判断)在 sync-plan.test.mts 里单测;这里测的是编排:
 * 翻页与游标一起提交、跳到最新时作废缓存、并发上限与优先级、实时序号推进与缺口补拉、
 * 切号后在途结果作废。
 */

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

function runModule(rel, requireImpl, globals = {}) {
  const context = {
    module: { exports: {} },
    exports: {},
    require: requireImpl,
    ...globals,
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpile(rel), context);
  return context.module.exports;
}

function page(overrides = {}) {
  return {
    messages: [],
    nextRevision: 0,
    throughRevision: 0,
    hasMore: false,
    resetRequired: false,
    readHeight: 0,
    clearedBeforeHeight: 0,
    ...overrides,
  };
}

function msg(id, height, revision, overrides = {}) {
  return {
    id,
    conversationId: 'c1',
    height,
    revision,
    type: 'text',
    content: { text: id },
    sender: null,
    replyToId: null,
    d: null,
    createdAt: '2026-09-16T00:00:00.000Z',
    ...overrides,
  };
}

function loadSync(options = {}) {
  const calls = {
    fetches: [],
    localPages: [],
    resets: [],
    redactions: [],
    cursorWrites: [],
    storePages: [],
    evictions: [],
    histories: [],
    stateReads: 0,
  };
  const pages = options.pages ?? {};
  const timers = new Map();
  let nextTimer = 1;
  const storeState = {
    messagesByConversation: options.memory ?? {},
    activeConversationId: options.active ?? null,
    applySyncPage: (conversationId, result) =>
      calls.storePages.push({ conversationId, nextRevision: result.nextRevision }),
    evictConversationCache: (conversationId) => calls.evictions.push(conversationId),
  };
  const syncPlan = runModule('src/chat-core/sync-plan.ts', () => {
    throw new Error('sync-plan should have no runtime deps');
  });
  const sync = runModule(
    'src/chat-core/sync.ts',
    withObservabilityStubs((request) => {
      switch (request) {
        case './api':
          return {
            fetchChatSyncPage: (conversationId, afterRevision) => {
              calls.fetches.push([conversationId, afterRevision]);
              const next = (pages[conversationId] ?? []).shift();
              return typeof next === 'function'
                ? next()
                : Promise.resolve(next ?? null);
            },
            loadChatHistory: async (conversationId) => {
              calls.histories.push(conversationId);
            },
          };
        case './local-db':
          return {
            initChatLocalDb: async () => true,
            readLocalSyncStates: async () => {
              calls.stateReads += 1;
              return new Map(Object.entries(options.localStates ?? {}));
            },
            applyLocalSyncPage: async (conversationId, localPage) => {
              calls.localPages.push({ conversationId, ...localPage });
              return true;
            },
            redactLocalQuotesOf: async (conversationId, ids, mode) => {
              calls.redactions.push({ conversationId, ids: [...ids], mode });
            },
            resetLocalConversationCache: async (conversationId, revision) => {
              calls.resets.push([conversationId, revision]);
              return true;
            },
            writeLocalSyncRevision: async (conversationId, revision) => {
              calls.cursorWrites.push([conversationId, revision]);
              return true;
            },
          };
        case './store':
          return { useChatStore: { getState: () => storeState } };
        case './sync-plan':
          return syncPlan;
        default:
          throw new Error(`unexpected require: ${request}`);
      }
    }),
    {
      setTimeout: (fn, delay) => {
        const id = nextTimer++;
        timers.set(id, { fn, delay });
        return id;
      },
      clearTimeout: (id) => {
        timers.delete(id);
      },
    },
  );
  const runTimers = () => {
    for (const [id, timer] of [...timers]) {
      timers.delete(id);
      timer.fn();
    }
  };
  return { sync, calls, storeState, timers, runTimers };
}

const flush = async () => {
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

test('a cached conversation pulls every page and commits each page together with its cursor', async () => {
  const { sync, calls } = loadSync({
    localStates: { c1: { revision: 10, hasMessages: true } },
    pages: {
      c1: [
        page({
          messages: [msg('m11', 11, 11)],
          nextRevision: 210,
          throughRevision: 450,
          hasMore: true,
        }),
        page({ nextRevision: 450, throughRevision: 450 }),
      ],
    },
  });
  sync.startChatSync('u1');

  await sync.syncConversationsFromSnapshot([{ id: 'c1', syncRevision: 450 }]);

  // 单页有上限:只拉一页的话,后面那些变更要等下一次重连。
  assert.deepEqual(calls.fetches, [
    ['c1', 10],
    ['c1', 210],
  ]);
  // 本地库那半与游标同一个事务:内存与磁盘各落一次,游标跟着页走。
  assert.deepEqual(
    calls.localPages.map((p) => p.revision),
    [210, 450],
  );
  assert.deepEqual(
    calls.storePages.map((p) => p.nextRevision),
    [210, 450],
  );

  // 追平之后同一个快照再来一次:什么都不做。
  await sync.syncConversationsFromSnapshot([{ id: 'c1', syncRevision: 450 }]);
  assert.equal(calls.fetches.length, 2);
});

test('a conversation with nothing cached adopts the server position instead of pulling its history', async () => {
  const { sync, calls, runTimers } = loadSync();
  sync.startChatSync('u1');

  await sync.syncConversationsFromSnapshot([{ id: 'c1', syncRevision: 300 }]);

  // 新装机/从没打开过的会话:没有要对账的缓存,打开时拉最新一页就够了。
  assert.deepEqual(calls.fetches, []);
  runTimers();
  assert.deepEqual(calls.cursorWrites, [['c1', 300]]);
});

test('a cache that fell too far behind is dropped and reloaded instead of replayed page by page', async () => {
  const notified = [];
  const { sync, calls } = loadSync({
    localStates: { c1: { revision: 10, hasMessages: true } },
  });
  sync.setConversationCacheResetHandler((conversationId) => notified.push(conversationId));
  sync.startChatSync('u1');

  await sync.syncConversationsFromSnapshot([{ id: 'c1', syncRevision: 5000 }]);

  assert.deepEqual(calls.fetches, []);
  assert.deepEqual(calls.evictions, ['c1']);
  assert.deepEqual(calls.resets, [['c1', 5000]]);
  // 页面层要复位向前翻页的游标,不然往上翻会从作废之前的位置接着翻。
  assert.deepEqual(notified, ['c1']);
});

test('a cursor the server cannot honor resets that conversation and reloads it when it is open', async () => {
  const { sync, calls } = loadSync({
    active: 'c1',
    localStates: { c1: { revision: 40, hasMessages: true } },
    pages: {
      c1: [page({ resetRequired: true, nextRevision: 30, throughRevision: 30 })],
    },
  });
  sync.startChatSync('u1');

  await sync.syncConversationsFromSnapshot([{ id: 'c1', syncRevision: 45 }]);

  assert.deepEqual(calls.resets, [['c1', 30]]);
  assert.deepEqual(calls.localPages, []);
  assert.deepEqual(calls.storePages, []);
  // 没有页面层接管时,正开着的会话按最新一页重拉,不能就这么空着。
  assert.deepEqual(calls.histories, ['c1']);
});

test('tombstones are deleted locally and quotes of burned or recalled messages are redacted', async () => {
  const { sync, calls } = loadSync({
    localStates: { c1: { revision: 1, hasMessages: true } },
    pages: {
      c1: [
        page({
          messages: [
            msg('m2', 2, 2, { deleted: true, content: {} }),
            msg('m3', 3, 3, { revokedAt: '2026-09-16T00:00:00.000Z', content: {} }),
            msg('m4', 4, 4),
          ],
          nextRevision: 4,
          throughRevision: 4,
        }),
      ],
    },
  });
  sync.startChatSync('u1');

  await sync.syncConversationsFromSnapshot([{ id: 'c1', syncRevision: 4 }]);

  assert.deepEqual(calls.localPages[0].deletedIds, ['m2']);
  assert.deepEqual(
    calls.localPages[0].upserts.map((m) => m.id),
    ['m3', 'm4'],
  );
  assert.deepEqual(calls.redactions, [
    { conversationId: 'c1', ids: ['m2'], mode: 'gone' },
    { conversationId: 'c1', ids: ['m3'], mode: 'revoked' },
  ]);
});

test('at most four conversations sync at once and the open conversation goes first', async () => {
  const ids = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'];
  const releases = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const pages = {};
  for (const id of ids) {
    pages[id] = [
      () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        return new Promise((resolve) => {
          releases.push(() => {
            inFlight -= 1;
            resolve(page({ nextRevision: 5, throughRevision: 5 }));
          });
        });
      },
    ];
  }
  const { sync, calls } = loadSync({
    localStates: Object.fromEntries(
      ids.map((id) => [id, { revision: 1, hasMessages: true }]),
    ),
    pages,
  });
  sync.startChatSync('u1');

  const done = sync.syncConversationsFromSnapshot(
    ids.map((id) => ({ id, syncRevision: 5 })),
    { prioritize: 'c5' },
  );
  await flush();
  assert.equal(calls.fetches.length, 4);
  assert.equal(calls.fetches[0][0], 'c5');

  while (releases.length > 0) {
    releases.shift()();
    await flush();
  }
  await done;
  assert.equal(maxInFlight, 4);
  assert.equal(calls.fetches.length, 6);
});

test('contiguous live revisions advance the cursor; a gap is pulled after a short wait', async () => {
  const { sync, calls, runTimers } = loadSync({
    localStates: { c1: { revision: 10, hasMessages: true } },
    pages: { c1: [page({ nextRevision: 13, throughRevision: 13 })] },
  });
  sync.startChatSync('u1');
  // 游标要先从本地库读出来,之前到的实时序号一律不算(连接时的快照同步会覆盖)。
  sync.noteLiveRevision('c1', 11);
  await sync.syncConversationsFromSnapshot([{ id: 'c1', syncRevision: 10 }]);
  assert.deepEqual(calls.fetches, []);

  sync.noteLiveRevision('c1', 11);
  // 12 没收到(漏了事件,或两个并发提交的广播到达顺序反了)。
  sync.noteLiveRevision('c1', 13);
  runTimers();
  await flush();

  assert.deepEqual(calls.cursorWrites, [['c1', 11]]);
  assert.deepEqual(calls.fetches, [['c1', 11]]);

  // 补上之后游标越过缓存着的 13,后面的实时序号照常连续推进。
  sync.noteLiveRevision('c1', 14);
  runTimers();
  assert.deepEqual(calls.cursorWrites.at(-1), ['c1', 14]);
});

test('token rotation keeps the loaded cursors; a different account starts from its own', async () => {
  const { sync, calls } = loadSync({
    localStates: { c1: { revision: 5, hasMessages: true } },
  });
  sync.startChatSync('u1');
  await sync.syncConversationsFromSnapshot([{ id: 'c1', syncRevision: 5 }]);
  assert.equal(calls.stateReads, 1);

  // 同一账号重复调用(token 轮换走 suspend + connect)不丢游标、不重读本地库。
  sync.startChatSync('u1');
  await sync.syncConversationsFromSnapshot([{ id: 'c1', syncRevision: 5 }]);
  assert.equal(calls.stateReads, 1);

  sync.startChatSync('u2');
  await sync.syncConversationsFromSnapshot([{ id: 'c1', syncRevision: 5 }]);
  assert.equal(calls.stateReads, 2);
});

test('a sync still in flight when the account changes never lands', async () => {
  let release;
  const { sync, calls } = loadSync({
    localStates: { c1: { revision: 1, hasMessages: true } },
    pages: {
      c1: [
        () =>
          new Promise((resolve) => {
            release = () => resolve(page({ nextRevision: 5, throughRevision: 5 }));
          }),
      ],
    },
  });
  sync.startChatSync('u1');
  const done = sync.syncConversationsFromSnapshot([{ id: 'c1', syncRevision: 5 }]);
  await flush();
  assert.equal(typeof release, 'function');

  sync.resetChatSync();
  sync.startChatSync('u2');
  release();
  await done;

  assert.deepEqual(calls.storePages, []);
  assert.deepEqual(calls.localPages, []);
});
