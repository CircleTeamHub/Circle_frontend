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

test('run keeps the key while the outcome is unsettled and drops it once the server decides', async () => {
  let sequence = 0;
  const { ApiError } = loadTsModule('src/services/api/api-error.ts');
  const { RetryIntentKeyStore } = loadTsModule(
    'src/features/profile/retry-intent-key.ts',
    {
      requireShim: (request) => {
        if (request === '@/services/api/mutation-outcome') {
          return loadTsModule('src/services/api/mutation-outcome.ts', {
            requireShim: (inner) => (inner === './api-error' ? { ApiError } : require(inner)),
          });
        }
        return require(request);
      },
    },
  );
  const store = new RetryIntentKeyStore(() => `key-${++sequence}`);
  const sent = [];
  const attempt = (outcome) =>
    store
      .run('create:a', async (key) => {
        sent.push(key);
        // ApiError comes from another vm realm, so `instanceof Error` cannot tell.
        if (typeof outcome !== 'string') throw outcome;
        return outcome;
      })
      .catch((error) => error);

  await attempt(new ApiError('timeout', { status: 0, failureKind: 'timeout' }));
  await attempt(new ApiError('busy', { status: 409, errorCode: 'IDEMPOTENCY_IN_PROGRESS' }));
  assert.equal(await attempt('created'), 'created');
  await attempt(new ApiError('no', { status: 403, errorCode: 'CIRCLE_CREATE_LIMIT' }));
  const rejected = await attempt(new ApiError('reused', { status: 409, errorCode: 'IDEMPOTENCY_KEY_REUSED' }));

  // Retries of an unsettled write share key-1; after success and after each
  // definitive rejection the next attempt is a new write.
  assert.deepEqual(sent, ['key-1', 'key-1', 'key-1', 'key-2', 'key-3']);
  assert.equal(rejected.errorCode, 'IDEMPOTENCY_KEY_REUSED');
});
