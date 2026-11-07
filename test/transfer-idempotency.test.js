const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

const HOUR = 60 * 60 * 1000;
const intent = { recipientId: 'u2', amount: 10, message: 'hello' };

function memoryStorage() {
  const values = new Map();
  return {
    values,
    getString: (key) => values.get(key),
    set: (key, value) => values.set(key, value),
    remove: (key) => values.delete(key),
  };
}

// Every load is a fresh module instance — what an app restart looks like. The
// storage passed in survives it, like the encrypted MMKV does.
function load(storage, keys) {
  return loadTsModule('src/features/chat/utils/transfer-idempotency.ts', {
    requireShim: (specifier) => {
      if (specifier === '@/utils/idempotency-key') {
        return { generateIdempotencyKey: () => keys.shift() };
      }
      if (specifier === '@/storage') return { storage };
      throw new Error(`Unexpected import: ${specifier}`);
    },
  });
}

test('an unsettled transfer keeps its key after leaving the composer or restarting the app', () => {
  const storage = memoryStorage();
  const keys = ['key-1', 'key-2'];

  const first = load(storage, keys).resolveTransferIdempotencyKey('me', intent, 0);
  const afterRestart = load(storage, keys).resolveTransferIdempotencyKey('me', intent, 23 * HOUR);

  assert.equal(first, 'key-1');
  assert.equal(afterRestart, 'key-1');
});

test('a different recipient, amount or message is a different transfer; the earlier one stays pending', () => {
  const storage = memoryStorage();
  const { resolveTransferIdempotencyKey } = load(storage, ['key-1', 'key-2', 'key-3', 'key-4']);

  assert.equal(resolveTransferIdempotencyKey('me', intent, 0), 'key-1');
  assert.equal(resolveTransferIdempotencyKey('me', { ...intent, amount: 11 }, 1), 'key-2');
  assert.equal(resolveTransferIdempotencyKey('me', { ...intent, recipientId: 'u3' }, 2), 'key-3');
  assert.equal(resolveTransferIdempotencyKey('me', { ...intent, message: null }, 3), 'key-4');
  // Going back to the first transfer must not mint a second charge.
  assert.equal(resolveTransferIdempotencyKey('me', intent, 4), 'key-1');
});

test('a pending key expires after 24 hours', () => {
  const storage = memoryStorage();
  const { resolveTransferIdempotencyKey } = load(storage, ['key-1', 'key-2']);

  assert.equal(resolveTransferIdempotencyKey('me', intent, 0), 'key-1');
  assert.equal(resolveTransferIdempotencyKey('me', intent, 24 * HOUR), 'key-2');
});

test('settling a transfer clears only its own key', () => {
  const storage = memoryStorage();
  const { resolveTransferIdempotencyKey, settleTransferIdempotencyKey } = load(storage, [
    'key-1',
    'key-2',
    'key-3',
  ]);
  const other = { ...intent, amount: 99 };

  assert.equal(resolveTransferIdempotencyKey('me', intent, 0), 'key-1');
  assert.equal(resolveTransferIdempotencyKey('me', other, 0), 'key-2');
  settleTransferIdempotencyKey('me', 'key-1', 1);

  assert.equal(resolveTransferIdempotencyKey('me', intent, 2), 'key-3');
  assert.equal(resolveTransferIdempotencyKey('me', other, 2), 'key-2');
});

test('pending keys belong to the signed-in user', () => {
  const storage = memoryStorage();
  const { resolveTransferIdempotencyKey } = load(storage, ['key-1', 'key-2']);

  assert.equal(resolveTransferIdempotencyKey('me', intent, 0), 'key-1');
  assert.equal(resolveTransferIdempotencyKey('someone-else', intent, 0), 'key-2');
});

test('the last settled transfer leaves nothing behind in storage', () => {
  const storage = memoryStorage();
  const { resolveTransferIdempotencyKey, settleTransferIdempotencyKey } = load(storage, ['key-1']);

  resolveTransferIdempotencyKey('me', intent, 0);
  settleTransferIdempotencyKey('me', 'key-1', 1);

  assert.equal(storage.values.size, 0);
});

test('transfer composer sends the persisted key to sendCoinGift', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/features/chat/screens/TransferComposerScreen.tsx'),
    'utf8',
  );

  assert.match(source, /resolveTransferIdempotencyKey\(/);
  assert.match(source, /sendCoinGift\([\s\S]*?idempotencyKey/);
});
