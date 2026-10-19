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
    /** 本地库写入的先后顺序(脱敏必须排在提交那一页之前)。 */
    order: [],
    stateReads: 0,
  };
  const pages = options.pages ?? {};
  const timers = new Map();
  let nextTimer = 1;
  const storeState = {
    messagesByConversation: options.memory ?? {},
    activeConversationId: options.active ?? null,
    applySyncPage: async (conversationId, result) => {
      calls.storePages.push({ conversationId, nextRevision: result.nextRevision, messages: result.messages });
      await options.applyStorePage?.(conversationId, result);
    },
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
              return (await options.loadHistory?.(conversationId)) ?? { messages: [] };
            },
          };
        case './local-db':
          return {
            initChatLocalDb: options.openDb ?? (async () => true),
            readLocalSyncStates: async () => {
              calls.stateReads += 1;
              return new Map(Object.entries(options.localStates ?? {}));
            },
            applyLocalSyncPage: async (conversationId, localPage) => {
              calls.localPages.push({ conversationId, ...localPage });
              calls.order.push('apply');
              return options.applyPage?.(conversationId, localPage) ?? true;
            },
            redactLocalQuotesOf: async (conversationId, ids, mode) => {
              calls.redactions.push({ conversationId, ids: [...ids], mode });
              calls.order.push(`redact:${mode}`);
              return options.redact?.(mode) ?? true;
            },
            resetLocalConversationCache: async (conversationId, revision) => {
              calls.resets.push([conversationId, revision]);
              return options.resetCache?.() ?? true;
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

test('a live mutation that was not applied locally keeps the cursor behind until sync commits it', async () => {
  const { sync, calls, runTimers } = loadSync({
    localStates: { c1: { revision: 10, hasMessages: true } },
    pages: {
      c1: [
        page({
          messages: [msg('edited-old', 4, 11, { content: { text: 'edited' } })],
          nextRevision: 11,
          throughRevision: 11,
        }),
      ],
    },
  });
  sync.startChatSync('u1');
  await sync.syncConversationsFromSnapshot([{ id: 'c1', syncRevision: 10 }]);

  // The live target was outside the memory window, so the dispatcher tells
  // sync not to advance the cursor optimistically.
  sync.noteLiveRevision('c1', 11, false);
  runTimers();
  await flush();

  assert.deepEqual(calls.fetches, [['c1', 10]]);
  assert.equal(calls.localPages.length, 1);
  assert.equal(calls.localPages[0].upserts[0].id, 'edited-old');

  runTimers();
  await flush();
  // The pull commits the page and its revision in one local-db transaction;
  // the standalone delayed cursor writer is not involved in this path.
  assert.deepEqual(calls.cursorWrites, []);
  assert.equal(calls.localPages[0].revision, 11);
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

test('a page that did not land in the local database stops the run and leaves the stored cursor behind it', async () => {
  const { sync, calls, runTimers } = loadSync({
    localStates: { c1: { revision: 10, hasMessages: true } },
    // 本地库写失败(磁盘满、事务被别的写打断)。
    applyPage: () => false,
    pages: {
      c1: [
        page({
          messages: [msg('m11', 11, 11, { deleted: true, content: {} })],
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

  // 后面那一页不能接着翻:它自己的事务会把游标写到 450,把没落盘的这一段
  // (这里是一条焚毁墓碑)永远跳过 —— 重启后本地缓存里还留着本该烧掉的正文。
  assert.deepEqual(calls.fetches, [['c1', 10]]);

  // 下一次对账从原地重追(应用是幂等的)。
  await sync.syncConversationsFromSnapshot([{ id: 'c1', syncRevision: 450 }]);
  assert.deepEqual(calls.fetches, [
    ['c1', 10],
    ['c1', 10],
  ]);

  // 之后来的实时消息也不能替它把游标写下去。
  sync.noteLiveRevision('c1', 11);
  runTimers();
  await flush();
  assert.deepEqual(calls.cursorWrites, []);
});

test('quotes of burned or recalled messages are scrubbed before the cursor covering them is committed', async () => {
  const { sync, calls } = loadSync({
    localStates: { c1: { revision: 1, hasMessages: true } },
    pages: {
      c1: [
        page({
          messages: [
            msg('m2', 2, 2, { deleted: true, content: {} }),
            msg('m3', 3, 3, { revokedAt: '2026-09-16T00:00:00.000Z', content: {} }),
          ],
          nextRevision: 3,
          throughRevision: 3,
        }),
      ],
    },
  });
  sync.startChatSync('u1');

  await sync.syncConversationsFromSnapshot([{ id: 'c1', syncRevision: 3 }]);

  // 游标一提交,这一段就再也不会重追:脱敏必须排在它前面,否则 App 在两者之间
  // 被杀,被撤回/焚毁那条的引用原文就永远留在本地缓存和本地搜索里。
  assert.deepEqual(calls.order, ['redact:gone', 'redact:revoked', 'apply']);
});

test('a quote that could not be scrubbed leaves the page and its cursor uncommitted', async () => {
  const { sync, calls, runTimers } = loadSync({
    localStates: { c1: { revision: 1, hasMessages: true } },
    redact: () => false,
    pages: {
      c1: [
        page({
          messages: [msg('m2', 2, 2, { deleted: true, content: {} })],
          nextRevision: 2,
          throughRevision: 2,
        }),
      ],
    },
  });
  sync.startChatSync('u1');

  await sync.syncConversationsFromSnapshot([{ id: 'c1', syncRevision: 2 }]);

  assert.deepEqual(calls.localPages, []);
  sync.noteLiveRevision('c1', 2);
  runTimers();
  await flush();
  assert.deepEqual(calls.cursorWrites, []);
});

test('a cache reset that did not land locally keeps the stored cursor where it was', async () => {
  const { sync, calls, runTimers } = loadSync({
    localStates: { c1: { revision: 10, hasMessages: true } },
    resetCache: () => false,
  });
  sync.startChatSync('u1');

  // 落后太多:缓存整块作废、游标直接跳到最新 —— 但这一跳没能落盘。
  await sync.syncConversationsFromSnapshot([{ id: 'c1', syncRevision: 5000 }]);
  assert.deepEqual(calls.resets, [['c1', 5000]]);

  sync.noteLiveRevision('c1', 5001);
  runTimers();
  await flush();
  // 写下去的话,重启后本地库里还留着作废前那批消息,而游标已经在 5001。
  assert.deepEqual(calls.cursorWrites, []);
});


test('an expiry invalidation pulls without a loaded timeline instead of adopting the cursor', async () => {
  const expiry = '2026-10-19T00:01:00Z';
  const { sync, calls, runTimers } = loadSync({
    localStates: { c1: { revision: 10, hasMessages: false } },
    pages: { c1: [page({ messages: [msg('m1', 1, 11, { burnExpiresAt: expiry })], nextRevision: 11, throughRevision: 11 })] },
  });
  sync.startChatSync('u1');
  await sync.syncConversationsFromSnapshot([{ id: 'c1', syncRevision: 10 }]);
  sync.noteLiveRevision('c1', 11, false);
  await flush();
  runTimers();
  await flush();
  assert.deepEqual(calls.fetches, [['c1', 10]]);
  assert.equal(calls.localPages[0].upserts[0].burnExpiresAt, expiry);
  assert.equal(calls.localPages[0].revision, 11);
  sync.resetChatSync();
});

test('an invalidation arriving during cursor initialization survives an older captured snapshot', async () => {
  let opened;
  const opening = new Promise((resolve) => { opened = resolve; });
  const { sync, calls, runTimers } = loadSync({
    openDb: () => opening,
    localStates: { c1: { revision: 10, hasMessages: false } },
    pages: { c1: [page({ messages: [msg('m1', 1, 11)], nextRevision: 11, throughRevision: 11 })] },
  });
  sync.startChatSync('u1');
  const snapshot = sync.syncConversationsFromSnapshot([{ id: 'c1', syncRevision: 10 }]);
  sync.noteLiveRevision('c1', 11, false);
  assert.equal(calls.fetches.length, 0);
  opened(true);
  await snapshot;
  await flush();
  runTimers();
  await flush();
  assert.deepEqual(calls.fetches, [['c1', 10]]);
  assert.equal(calls.localPages[0].revision, 11);
  sync.resetChatSync();
});

test('queued invalidations are discarded on account switching before SQLite opens', async () => {
  let opened;
  const opening = new Promise((resolve) => { opened = resolve; });
  const { sync, calls, runTimers } = loadSync({ openDb: () => opening });
  sync.startChatSync('u1');
  sync.noteLiveRevision('c1', 11, false);
  sync.startChatSync('u2');
  opened(true);
  await flush();
  runTimers();
  await flush();
  assert.deepEqual(calls.fetches, []);
  sync.resetChatSync();
});


test('failed forced expiry pulls retry with capped backoff until the authoritative page is stored', async () => {
  const { sync, calls, timers, runTimers } = loadSync({
    localStates: { c1: { revision: 10, hasMessages: false } },
    pages: { c1: [() => Promise.reject(new Error('timeout')), () => Promise.reject(new Error('offline')), page({ nextRevision: 11, throughRevision: 11 })] },
  });
  sync.startChatSync('u1');
  await sync.syncConversationsFromSnapshot([{ id: 'c1', syncRevision: 10 }]);
  sync.noteLiveRevision('c1', 11, false);
  runTimers(); await flush();
  assert.deepEqual([...timers.values()].map(t => t.delay), [1500]);
  assert.equal(calls.localPages.length, 0);
  runTimers(); await flush();
  assert.deepEqual([...timers.values()].map(t => t.delay), [3000]);
  runTimers(); await flush();
  assert.deepEqual(calls.fetches, [['c1', 10], ['c1', 10], ['c1', 10]]);
  assert.equal(calls.localPages[0].revision, 11);
  assert.equal(timers.size, 0);
  sync.resetChatSync();
});

test('a forced invalidation above the live window and page cap resets and refreshes once instead of replaying pages', async () => {
  const { sync, calls, runTimers } = loadSync({ localStates: { c1: { revision: 10, hasMessages: false } } });
  sync.startChatSync('u1');
  sync.noteLiveRevision('c1', 10_000, false);
  await sync.syncConversationsFromSnapshot([{ id: 'c1', syncRevision: 9000 }]);
  runTimers(); await flush();
  assert.deepEqual(calls.fetches, []);
  assert.deepEqual(calls.resets, [['c1', 10_000]]);
  assert.deepEqual(calls.histories, ['c1']);
  sync.resetChatSync();
});

test('failed forced retries are cancelled on account switch', async () => {
  const { sync, calls, runTimers } = loadSync({ localStates: { c1: { revision: 10, hasMessages: false } }, pages: { c1: [() => Promise.reject(new Error('timeout'))] } });
  sync.startChatSync('u1');
  await sync.syncConversationsFromSnapshot([{ id: 'c1', syncRevision: 10 }]);
  sync.noteLiveRevision('c1', 11, false);
  runTimers(); await flush();
  sync.startChatSync('u2');
  runTimers(); await flush();
  assert.deepEqual(calls.fetches, [['c1', 10]]);
  sync.resetChatSync();
});


test('a forced large-gap reload is retried if the history request fails after the reset', async () => {
  let reloads = 0;
  const { sync, calls, runTimers } = loadSync({ localStates: { c1: { revision: 10, hasMessages: false } }, loadHistory: () => { if (++reloads === 1) throw new Error('offline'); } });
  sync.startChatSync('u1');
  sync.noteLiveRevision('c1', 10_000, false);
  await sync.syncConversationsFromSnapshot([{ id: 'c1', syncRevision: 9000 }]);
  runTimers(); await flush();
  assert.equal(reloads, 2);
  assert.deepEqual(calls.fetches, []);
  assert.deepEqual(calls.resets, [['c1', 10_000]]);
  sync.resetChatSync();
});

test('a failed forced expiry pull retries with bounded backoff',async()=>{
 const {sync,calls,runTimers}=loadSync({localStates:{c1:{revision:10,hasMessages:false}},pages:{c1:[()=>Promise.reject(new Error('timeout')),page({nextRevision:11,throughRevision:11})]}});
 sync.startChatSync('u1');await sync.syncConversationsFromSnapshot([{id:'c1',syncRevision:10}]);sync.noteLiveRevision('c1',11,false);await flush();runTimers();await flush();runTimers();await flush();
 assert.deepEqual(calls.fetches,[['c1',10],['c1',10]]);sync.resetChatSync();
});
test('a forced pull beyond the page cap keeps the normal large-gap cache reset',async()=>{
 const {sync,calls,runTimers}=loadSync({localStates:{c1:{revision:10,hasMessages:false}}});
 sync.startChatSync('u1');await sync.syncConversationsFromSnapshot([{id:'c1',syncRevision:10}]);sync.noteLiveRevision('c1',5010,false);await flush();runTimers();await flush();
 assert.deepEqual(calls.fetches,[]);assert.deepEqual(calls.resets,[['c1',5010]]);sync.resetChatSync();
});


test('permanent forced-sync failures stop after six retries and resume on a new snapshot', async () => {
  const { sync, calls, timers, runTimers } = loadSync({ localStates: { c1: { revision: 10, hasMessages: false } }, pages: { c1: Array.from({length: 20}, () => () => Promise.reject(new Error('permanent'))) } });
  sync.startChatSync('u1');
  await sync.syncConversationsFromSnapshot([{id:'c1',syncRevision:10}]);
  sync.noteLiveRevision('c1',11,false);
  for (let i=0;i<15;i++) { runTimers(); await flush(); }
  assert.equal(calls.fetches.length,7);
  assert.equal(timers.size,0);
  await sync.syncConversationsFromSnapshot([{id:'c1',syncRevision:11}]);
  assert.equal(calls.fetches.length,8);
  sync.resetChatSync();
});

test('a forced large-gap history reload reconciles the matching offscreen preview DTO', async () => {
 const expiry = new Date(Date.now()+60_000).toISOString();
 const updated=msg('latest',99,10000,{burnDurationSec:60,burnExpiresAt:expiry});
 const {sync,calls,runTimers}=loadSync({localStates:{c1:{revision:10,hasMessages:false}},loadHistory:async()=>({messages:[updated]})});
 sync.startChatSync('u1');sync.noteLiveRevision('c1',10000,false);
 await sync.syncConversationsFromSnapshot([{id:'c1',syncRevision:9000}]);
 runTimers();await flush();
 assert.equal(calls.storePages[0].messages[0].burnExpiresAt,expiry);
 sync.resetChatSync();
});


test('pulled deadlines are persisted before the store purges expired local content', async () => {
 let storedDeadline=null;
 const expiry=new Date(Date.now()-1000).toISOString();
 const {sync}=loadSync({localStates:{c1:{revision:10,hasMessages:true}},pages:{c1:[page({messages:[msg('cached',1,11,{burnExpiresAt:expiry})],nextRevision:11,throughRevision:11})]},
 applyPage:async (_id,page)=>{storedDeadline=page.upserts[0].burnExpiresAt;return true;},
 applyStorePage:async ()=>assert.equal(storedDeadline,expiry)});
 sync.startChatSync('u1');
 await sync.syncConversationsFromSnapshot([{id:'c1',syncRevision:11}]);
 sync.resetChatSync();
});

test('foreground resumes exhausted invalidations while the websocket session stays connected', async () => {
 const {sync,calls,timers,runTimers}=loadSync({localStates:{c1:{revision:10,hasMessages:false}},pages:{c1:[...Array.from({length:7},()=>()=>Promise.reject(new Error('offline'))),page({nextRevision:11,throughRevision:11})]}});
 sync.startChatSync('u1');await sync.syncConversationsFromSnapshot([{id:'c1',syncRevision:10}]);sync.noteLiveRevision('c1',11,false);
 for(let i=0;i<15;i++){runTimers();await flush();}
 assert.equal(calls.fetches.length,7);assert.equal(timers.size,0);
 await sync.resumePendingChatSync();
 assert.equal(calls.fetches.length,8);assert.equal(calls.localPages[0].revision,11);assert.equal(timers.size,0);
 sync.resetChatSync();
});
