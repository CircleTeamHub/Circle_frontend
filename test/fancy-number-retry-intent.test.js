const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

test('retry intent keeps its key until the semantic operation changes or succeeds', () => {
  let sequence = 0;
  const { RetryIntentKeyStore } = loadTsModule(
    'src/features/profile/retry-intent-key.ts',
  );
  const store = new RetryIntentKeyStore(() => `key-${++sequence}`);

  const renewal = 'renew:AB12C3:1';
  assert.equal(store.get(renewal), 'key-1');

  // Connectivity and locale changes do not alter the purchase intent.
  assert.equal(store.get(renewal), 'key-1');
  assert.equal(store.get(renewal), 'key-1');

  const newerRenewal = 'renew:AB12C3:2';
  assert.equal(store.get(newerRenewal), 'key-2');

  // A stale completion must not clear the newer operation's retry key.
  assert.equal(store.complete(renewal, 'key-1'), false);
  assert.equal(store.get(newerRenewal), 'key-2');

  assert.equal(store.complete(newerRenewal, 'key-2'), true);
  assert.equal(store.get(newerRenewal), 'key-3');
});
