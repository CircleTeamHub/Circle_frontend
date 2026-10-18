const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const ts = require('typescript');

async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'circle-native-vault-'));
  const core = await import('@circle/e2ee');
  const codec = await import('@circle/e2ee/journal-codec.mjs');
  const archive = await import('@circle/e2ee/archive-store.mjs');
  const secrets = new Map();
  const accessOptions = [];
  const databases = new Set();
  let opens = 0;
  const sqlite = {
    async openDatabaseAsync(name) {
      opens++;
      const db = new DatabaseSync(path.join(directory, name));
      databases.add(db);
      const api = {
        async execAsync(sql) { db.exec(sql); },
        async getFirstAsync(sql, ...params) { return db.prepare(sql).get(...params) ?? null; },
        async getAllAsync(sql, ...params) { return db.prepare(sql).all(...params); },
        async runAsync(sql, ...params) { return db.prepare(sql).run(...params); },
        async withExclusiveTransactionAsync(callback) {
          db.exec('BEGIN IMMEDIATE');
          try { await callback(api); db.exec('COMMIT'); }
          catch (error) { db.exec('ROLLBACK'); throw error; }
        },
        async closeAsync() { db.close(); databases.delete(db); },
      };
      return api;
    },
  };
  const secureStore = {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only-unlocked',
    async getItemAsync(key) { return secrets.get(key) ?? null; },
    async setItemAsync(key, value, options) {
      accessOptions.push(options);
      secrets.set(key, value);
    },
  };
  const exports = {};
  const context = vm.createContext({
    exports, module: { exports }, crypto: crypto.webcrypto,
    Uint8Array, TextEncoder, TextDecoder,
    require(name) {
      if (name === '@circle/e2ee') return core;
      if (name === '@circle/e2ee/archive-store.mjs') return archive;
      if (name === '@circle/e2ee/journal-codec.mjs') return codec;
      if (name === 'expo-sqlite') return sqlite;
      if (name === 'expo-secure-store') return secureStore;
      if (name === 'expo-crypto') return {
        randomUUID: crypto.randomUUID,
        getRandomBytes: crypto.randomBytes,
        getRandomValues: crypto.webcrypto.getRandomValues.bind(crypto.webcrypto),
      };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  const source = fs.readFileSync(path.join(process.cwd(), 'src/services/e2ee/journal.ts'), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInContext(output, context);
  t.after(() => {
    for (const db of databases) db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { replace: exports.prepareReplacementJournal, open: exports.openDeviceJournal, secrets, accessOptions, directory, opens: () => opens };
}

test('native key initialization is shared, device-only and isolated by account', async (t) => {
  const f = await fixture(t);
  const [first, same] = await Promise.all([f.open('alice'), f.open('alice')]);
  assert.equal(first, same);
  assert.equal(f.opens(), 1);
  const other = await f.open('bob');
  assert.notEqual(first.deviceId, other.deviceId);
  assert.equal(f.secrets.size, 2);
  assert.equal(f.accessOptions.every((option) => option.keychainAccessible === 'device-only-unlocked'), true);
  await first.save(0, { privateKey: 'only-alice' });
  assert.equal((await other.load()).record, null);
  await first.close();
  const reopened = await f.open('alice');
  assert.equal(reopened.deviceId, first.deviceId);
  assert.equal((await reopened.load()).record.privateKey, 'only-alice');
});

test('native storage encrypts disk bytes and commits only one expected revision', async (t) => {
  const f = await fixture(t);
  const journal = await f.open('alice');
  await journal.save(0, { privateKey: 'private material never stored as plaintext' });
  await assert.rejects(journal.save(0, { privateKey: 'conflicting state' }), /Concurrent/);
  await assert.rejects(journal.save(1, { privateKey: 'failed operation' }, () => { throw new Error('fault'); }), /fault/);
  assert.equal((await journal.load()).revision, 1);
  assert.equal((await journal.load()).record.privateKey, 'private material never stored as plaintext');
  for (const file of fs.readdirSync(f.directory)) {
    const bytes = fs.readFileSync(path.join(f.directory, file));
    assert.equal(bytes.includes(Buffer.from('private material never stored as plaintext')), false);
  }
  await journal.close();
  await assert.rejects(journal.load(), /locked/);
  await assert.rejects(journal.save(1, {}), /locked/);
});

test('a lost secure-store key does not silently recreate or overwrite existing state', async (t) => {
  const f = await fixture(t);
  const journal = await f.open('alice');
  await journal.save(0, { privateKey: 'retained state' });
  await journal.close();
  const saved = f.secrets.get('circle.e2ee.alice');
  f.secrets.delete('circle.e2ee.alice');
  await assert.rejects(f.open('alice'), /Encryption key unavailable/);
  assert.equal(f.secrets.has('circle.e2ee.alice'), false);
  f.secrets.set('circle.e2ee.alice', saved);
  assert.equal((await (await f.open('alice')).load()).record.privateKey, 'retained state');
});

test('archive scales past 1000 messages without growing hot state and atomically rolls back', async (t) => {
  const f = await fixture(t);
  const journal = await f.open('alice');
  let record = { groups: {}, inbox: {}, outbox: {} };
  await journal.save(0, record);
  for (let i = 0; i < 1100; i++) {
    const loaded = await journal.load();
    loaded.record.inbox[String(i).padStart(5, '0')] = { body: { text: `secret-${i}` } };
    await journal.save(loaded.revision, loaded.record);
  }
  const hot = await journal.load();
  assert.equal(Object.keys(hot.record.inbox).length, 0);
  assert.equal((await journal.pageItems('inbox', '', 20)).length, 20);
  assert.equal((await journal.getItem('inbox', '01099')).body.text, 'secret-1099');
  hot.record.inbox.fault = { body: { text: 'not committed' } };
  await assert.rejects(journal.save(hot.revision, hot.record, () => { throw new Error('crash'); }), /crash/);
  assert.equal(await journal.getItem('inbox', 'fault'), undefined);
  assert.equal((await journal.load()).revision, hot.revision);
  await journal.close();
  const reopened = await f.open('alice');
  assert.equal((await reopened.getItem('inbox', '01099')).body.text, 'secret-1099');
});


test('explicit missing-key recovery preserves the old sealed database and creates a fresh identity', async t => {
  const f = await fixture(t); const old = await f.open('alice');
  await old.save(0, { inbox: {}, outbox: {}, privateKey: 'old secret' });
  await old.close();
  await assert.rejects(f.replace('alice'), /already exists/);
  f.secrets.delete('circle.e2ee.alice');
  await assert.rejects(f.open('alice'), /Encryption key unavailable/);
  await f.replace('alice');
  const replacement = await f.open('alice');
  assert.notEqual(replacement.deviceId, old.deviceId);
  assert.equal((await replacement.load()).record, null);
  assert.equal(fs.existsSync(path.join(f.directory, 'e2ee-v1-alice.sqlite')), true);
});
