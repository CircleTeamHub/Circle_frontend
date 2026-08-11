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
  const state = { inTransaction: false, statements: [], transactions: 0 };
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
      state.statements.push({ sql, params });
    },
    closeAsync: async () => tick(),
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

function loadLocalDb(db, opened = []) {
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
            return db;
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
