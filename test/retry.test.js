const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadRetryModule() {
  const filePath = path.join(process.cwd(), 'src/utils/retry.ts');
  const source = fs.readFileSync(filePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;

  // retry.ts 仅 import ApiError 用于 instanceof 判断；测试里给一个等价 class 即可。
  class FakeApiError extends Error {
    constructor(message, status) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
    }
  }

  const context = {
    module: { exports: {} },
    exports: {},
    setTimeout,
    clearTimeout,
    AbortController,
    require: (specifier) => {
      if (specifier === '@/services/api/client') {
        return { ApiError: FakeApiError };
      }
      throw new Error(`Unexpected import: ${specifier}`);
    },
  };
  context.exports = context.module.exports;

  vm.runInNewContext(transpiled, context, { filename: filePath });
  return { retry: context.module.exports.retry, FakeApiError };
}

test('retry returns the value on the first successful attempt without delay', async () => {
  const { retry } = loadRetryModule();
  let calls = 0;
  const start = Date.now();
  const result = await retry(async () => {
    calls += 1;
    return 'ok';
  });
  const elapsed = Date.now() - start;
  assert.equal(result, 'ok');
  assert.equal(calls, 1);
  assert.ok(elapsed < 50, `should not delay on success (took ${elapsed}ms)`);
});

test('retry retries once on a transient network-style error and succeeds', async () => {
  const { retry } = loadRetryModule();
  let calls = 0;
  const result = await retry(
    async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('Network request failed');
      return 'recovered';
    },
    { backoffMs: 5 },
  );
  assert.equal(result, 'recovered');
  assert.equal(calls, 2);
});

test('retry exhausts attempts and rethrows the last error after all tries fail', async () => {
  const { retry } = loadRetryModule();
  let calls = 0;
  await assert.rejects(
    () =>
      retry(
        async () => {
          calls += 1;
          throw new TypeError('still down');
        },
        { backoffMs: 5, tries: 3 },
      ),
    /still down/,
  );
  assert.equal(calls, 3);
});

test('retry does NOT retry on 401 / 403 ApiError (auth errors are deterministic, not transient)', async () => {
  const { retry, FakeApiError } = loadRetryModule();
  let calls = 0;
  await assert.rejects(
    () =>
      retry(
        async () => {
          calls += 1;
          throw new FakeApiError('Unauthorized', 401);
        },
        { backoffMs: 5 },
      ),
    /Unauthorized/,
  );
  assert.equal(calls, 1, '401 must not trigger retry');

  calls = 0;
  await assert.rejects(
    () =>
      retry(
        async () => {
          calls += 1;
          throw new FakeApiError('Forbidden', 403);
        },
        { backoffMs: 5 },
      ),
    /Forbidden/,
  );
  assert.equal(calls, 1, '403 must not trigger retry');
});

test('retry DOES retry on 408 (request timeout) and 429 (rate limit) — those are recoverable', async () => {
  const { retry, FakeApiError } = loadRetryModule();
  let calls = 0;
  const result = await retry(
    async () => {
      calls += 1;
      if (calls === 1) throw new FakeApiError('Timeout', 408);
      return 'ok';
    },
    { backoffMs: 5 },
  );
  assert.equal(result, 'ok');
  assert.equal(calls, 2);

  calls = 0;
  const result2 = await retry(
    async () => {
      calls += 1;
      if (calls === 1) throw new FakeApiError('Too Many', 429);
      return 'ok';
    },
    { backoffMs: 5 },
  );
  assert.equal(result2, 'ok');
  assert.equal(calls, 2);
});

test('retry DOES retry on 5xx ApiError (server-side flap)', async () => {
  const { retry, FakeApiError } = loadRetryModule();
  let calls = 0;
  const result = await retry(
    async () => {
      calls += 1;
      if (calls === 1) throw new FakeApiError('Bad Gateway', 502);
      return 'ok';
    },
    { backoffMs: 5 },
  );
  assert.equal(result, 'ok');
  assert.equal(calls, 2);
});

test('retry bails immediately if the AbortSignal is already aborted', async () => {
  const { retry } = loadRetryModule();
  const ctrl = new AbortController();
  ctrl.abort();
  let calls = 0;
  await assert.rejects(
    () =>
      retry(
        async () => {
          calls += 1;
          return 'should not run';
        },
        { signal: ctrl.signal },
      ),
    (err) => err.name === 'AbortError',
  );
  assert.equal(calls, 0);
});

test('retry honors AbortSignal during backoff and rejects with AbortError', async () => {
  const { retry } = loadRetryModule();
  const ctrl = new AbortController();
  let calls = 0;
  const promise = retry(
    async () => {
      calls += 1;
      throw new TypeError('boom');
    },
    { backoffMs: 1000, signal: ctrl.signal },
  );
  setTimeout(() => ctrl.abort(), 10);
  await assert.rejects(promise, (err) => err.name === 'AbortError');
  assert.equal(calls, 1, 'should fail on the first try, then abort during backoff');
});
