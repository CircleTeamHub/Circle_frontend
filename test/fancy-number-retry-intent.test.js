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

  assert.equal(store.get('renew:AB12C3:2'), 'key-2');
  store.complete();
  assert.equal(store.get('renew:AB12C3:2'), 'key-3');
});
