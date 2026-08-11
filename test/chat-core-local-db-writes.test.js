const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

/**
 * 本地库写入的并发契约:真源码 + 假 expo-sqlite,在 vm 里跑。
 *
 * expo-sqlite 的 withTransactionAsync 文档明写「非独占,会被其它 async 查询
 * 打断」—— 同一条连接上两个并发调用,第二个 BEGIN 会撞上
 * "cannot start a transaction within a transaction",那一整批写入被吞掉。
 * 重连对账时多个会话同时落库就是这个形状。
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

/** 复刻真实 expo-sqlite 的关键语义:连接内不允许事务嵌套。 */
function fakeDatabase() {
  const state = {
    inTransaction: false,
    statements: [],
    transactions: 0,
    closed: false,
  };
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  const db = {
    state,
    execAsync: async () => tick(),
    getFirstAsync: async (sql) => {
      await tick();
      if (sql.includes('cipher_version')) return { cipher_version: '4.5.5' };
      return { lo: 1, hi: 1 };
    },
    getAllAsync: async () => {
      await tick();
      return [];
    },
    runAsync: async (sql, ...params) => {
      await tick();
      // 真 expo-sqlite 在关掉的连接上执行语句直接抛(NativeDatabase 已释放)。
      if (state.closed) throw new Error('Access to closed resource');
      state.statements.push({ sql, params });
    },
    closeAsync: async () => {
      await tick();
      state.closed = true;
    },
    withTransactionAsync: async (task) => {
      if (state.inTransaction) {
        throw new Error(
          "Calling the 'execAsync' function has failed\n" +
            '→ Caused by: cannot start a transaction within a transaction',
        );
      }
      state.inTransaction = true;
      state.transactions += 1;
      try {
        await task();
      } finally {
        state.inTransaction = false;
      }
    },
  };
  return db;
}

/** `db` 可以是单个句柄,也可以是每次 open 都造一个新句柄的工厂(切号用)。 */
function loadLocalDb(db, opened = []) {
  const openDb = typeof db === 'function' ? db : () => db;
  const context = {
    console: { warn: (...args) => context.__warnings.push(args) },
    setTimeout,
    setImmediate,
    Date,
    JSON,
    Math,
    module: { exports: {} },
    exports: {},
    __warnings: [],
    require: (request) => {
      if (request === 'expo-sqlite') {
        return {
          openDatabaseAsync: async (name, options) => {
            opened.push({ name, options });
            return openDb();
          },
        };
      }
      if (request === 'expo-secure-store') {
        return {
          AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'afu',
          getItemAsync: async () => 'ab'.repeat(32),
          setItemAsync: async () => undefined,
        };
      }
      if (request === 'expo-crypto') {
        return { getRandomBytesAsync: async () => new Uint8Array(32) };
      }
      throw new Error(`unexpected require: ${request}`);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpile('src/chat-core/local-db.ts'), context);
  return { api: context.module.exports, warnings: context.__warnings };
}

function msg(id, height) {
  return {
    id,
    conversationId: 'conv-1',
    height,
    type: 'text',
    content: { text: id },
    sender: null,
    replyToId: null,
    d: null,
    createdAt: '2026-08-11T00:00:00.000Z',
  };
}

test('并发落库不会踩事务嵌套(两批都写进去,不吞)', async () => {
  const db = fakeDatabase();
  const { api, warnings } = loadLocalDb(db);
  assert.equal(await api.initChatLocalDb('user-1'), true);

  // 重连对账:多个会话的历史同时回来。
  await Promise.all([
    api.persistLocalMessages('conv-1', [msg('a', 1)]),
    api.persistLocalMessages('conv-2', [msg('b', 1)]),
    api.persistLocalConversations([
      {
        id: 'conv-1',
        type: 'DIRECT',
        peer: null,
        lastMessage: null,
        unreadCount: 0,
        lastMessageAt: null,
      },
    ]),
  ]);

  assert.deepEqual(
    warnings.filter((w) => String(w[0]).includes('persist')),
    [],
  );
  assert.equal(db.state.transactions, 3);
  const inserted = db.state.statements.filter((s) =>
    s.sql.includes('INSERT INTO messages'),
  );
  assert.equal(inserted.length, 2);
});

test('开库时关掉 finalizeUnusedStatementsBeforeClosing(否则 FTS5 二次释放,闪退)', async () => {
  // 默认 true:关库前遍历 sqlite3_next_stmt 把 FTS5 内部语句也 finalize 掉,
  // 紧接着 sqlite3_close 里 fts5 自己再 finalize 一次 → EXC_BAD_ACCESS。
  // dev 下每次 reload 都会走 expo-sqlite 的 OnDestroy 强制关库。
  // https://github.com/expo/expo/issues/38168
  const opened = [];
  const { api } = loadLocalDb(fakeDatabase(), opened);
  await api.initChatLocalDb('user-1');

  assert.equal(opened.length, 1);
  assert.equal(opened[0].options?.finalizeUnusedStatementsBeforeClosing, false);
});

test('串行化不吃掉失败:一批炸了后面的照常写', async () => {
  const db = fakeDatabase();
  const { api } = loadLocalDb(db);
  await api.initChatLocalDb('user-1');

  const original = db.runAsync;
  let failNext = true;
  db.runAsync = async (sql, ...params) => {
    if (failNext && sql.includes('INSERT INTO messages')) {
      failNext = false;
      throw new Error('disk I/O error');
    }
    return original(sql, ...params);
  };

  await api.persistLocalMessages('conv-1', [msg('boom', 1)]);
  await api.persistLocalMessages('conv-2', [msg('ok', 1)]);

  const inserted = db.state.statements.filter((s) =>
    s.sql.includes('INSERT INTO messages'),
  );
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].params[0], 'ok');
});

test('切号:排队里的写入先落完,再关旧账号的库', async () => {
  // codex review:initChatLocalDb 不等 writeQueue 就 closeAsync 旧句柄 ——
  // 队列里的回调仍握着那个已经关掉的连接,执行时抛错,而 outbox / 已读水位
  // 这些写入方都是 warn 一声吞掉。丢的是上一个账号还没发出去的消息和待上报
  // 的已读位置,用户永远看不到任何提示。
  const dbs = [];
  const { api, warnings } = loadLocalDb(() => {
    const db = fakeDatabase();
    dbs.push(db);
    return db;
  });
  assert.equal(await api.initChatLocalDb('user-1'), true);

  // 卡住第一笔 outbox 写入,制造积压。
  const first = dbs[0];
  const original = first.runAsync;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let gated = true;
  first.runAsync = async (sql, ...params) => {
    if (gated && sql.includes('INSERT OR REPLACE INTO outbox')) {
      gated = false;
      await gate;
    }
    return original(sql, ...params);
  };

  const entry = (d) => ({
    d,
    conversationId: 'conv-1',
    payload: { conversationId: 'conv-1', type: 'text', content: {}, d },
    createdAt: '2026-08-11T00:00:00.000Z',
  });
  const writes = [api.outboxUpsert(entry('d-1')), api.outboxUpsert(entry('d-2'))];

  // 积压还在的时候切号。
  const switching = api.initChatLocalDb('user-2');
  release();
  await Promise.all([...writes, switching]);

  const outboxWrites = first.state.statements.filter((s) =>
    s.sql.includes('INSERT OR REPLACE INTO outbox'),
  );
  assert.equal(outboxWrites.length, 2, '排队中的待发消息随切号丢了');
  assert.deepEqual(
    warnings.filter((w) => String(w[0]).includes('outbox')),
    [],
  );
  // 旧库最终仍要关掉(否则切号后两条连接一起挂着)。
  assert.equal(first.state.closed, true);
  assert.equal(dbs.length, 2);
  assert.equal(dbs[1].state.closed, false);
});

test('closeChatLocalDb 同样先把积压写完', async () => {
  const db = fakeDatabase();
  const { api } = loadLocalDb(db);
  await api.initChatLocalDb('user-1');

  const original = db.runAsync;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let gated = true;
  db.runAsync = async (sql, ...params) => {
    if (gated && sql.includes('INSERT INTO pending_reads')) {
      gated = false;
      await gate;
    }
    return original(sql, ...params);
  };

  const writes = [
    api.pendingReadUpsert('conv-1', 7),
    api.pendingReadUpsert('conv-2', 9),
  ];
  const closing = api.closeChatLocalDb();
  release();
  await Promise.all([...writes, closing]);

  assert.equal(
    db.state.statements.filter((s) =>
      s.sql.includes('INSERT INTO pending_reads'),
    ).length,
    2,
  );
  assert.equal(db.state.closed, true);
});

test('burn expiry purge batches message and outbox deletion in one transaction', async () => {
  const db = fakeDatabase();
  const { api } = loadLocalDb(db);
  await api.initChatLocalDb('user-1');
  const transactionsBefore = db.state.transactions;

  await api.purgeExpiredLocalMessages([
    { conversationId: 'conv-1', cutoff: new Date('2026-08-10T00:00:00.000Z') },
    { conversationId: 'conv-2', cutoff: new Date('2026-08-09T00:00:00.000Z') },
  ]);

  assert.equal(db.state.transactions, transactionsBefore + 1);
  const deletes = db.state.statements.filter((statement) =>
    statement.sql.startsWith('DELETE FROM'),
  );
  assert.equal(deletes.filter((statement) => statement.sql.includes('messages')).length, 2);
  assert.equal(deletes.filter((statement) => statement.sql.includes('outbox')).length, 2);
});
