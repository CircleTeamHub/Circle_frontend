const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function deferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function response(ok, status, body) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(body),
  };
}

async function waitFor(condition) {
  for (let i = 0; i < 50; i += 1) {
    if (condition()) return;
    await Promise.resolve();
  }
  throw new Error('timed out waiting for condition');
}

function loadApiClientHarness() {
  const filePath = path.join(process.cwd(), 'src/services/api/client.ts');
  const source = fs.readFileSync(filePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;

  const fetchCalls = [];
  const refreshResponses = [];
  const requestResponses = [];
  const setTokenCalls = [];
  let clearCalls = 0;
  let clearPause = null;
  let logoutHandler = null;
  const authState = {
    accessToken: 'access-a',
    refreshToken: 'refresh-a',
    sessionEpoch: 1,
    setTokens: (tokens) => {
      setTokenCalls.push(tokens);
      authState.accessToken = tokens.accessToken;
      authState.refreshToken = tokens.refreshToken;
    },
  };

  async function clearLocalSession(expectedSessionEpoch) {
    clearCalls += 1;
    if (clearPause) {
      clearPause.started.resolve();
      await clearPause.release.promise;
    }
    if (
      expectedSessionEpoch !== undefined &&
      authState.sessionEpoch !== expectedSessionEpoch
    ) {
      return;
    }
    authState.accessToken = null;
    authState.refreshToken = null;
    authState.sessionEpoch += 1;
  }

  const context = {
    module: { exports: {} },
    exports: {},
    __DEV__: false,
    AbortController,
    ArrayBuffer,
    Blob,
    FormData,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    fetch: async (url, options) => {
      fetchCalls.push([url, options]);
      if (String(url).endsWith('/auth/refresh')) {
        const next = refreshResponses.shift();
        if (!next) throw new Error('missing refresh response');
        return next.promise;
      }
      const next = requestResponses.shift();
      return next
        ? next.promise
        : response(false, 401, { code: 1, message: 'expired', data: null });
    },
    require: (request) => {
      if (request === '@/constants/config') {
        return { API_URL: 'https://api.example.test/api/v1' };
      }
      if (request === '@/services/auth/session') {
        return {
          clearLocalSession,
          registerLogoutHandler: (handler) => {
            logoutHandler = handler;
            return () => {};
          },
        };
      }
      if (request === '@/stores/authStore') {
        return {
          useAuthStore: {
            getState: () => authState,
          },
        };
      }
      if (request === '@/observability/sentry') {
        return {
          reportError: () => {},
          shouldReportHttpFailure: () => false,
        };
      }
      if (request === '@/i18n') {
        return {
          __esModule: true,
          default: {
            t: (_key, opts) => opts?.defaultValue ?? _key,
            language: 'zh',
          },
        };
      }
      return require(request);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });

  return {
    ...context.module.exports,
    authState,
    fetchCalls,
    refreshResponses,
    requestResponses,
    setTokenCalls,
    getClearCalls: () => clearCalls,
    getLogoutHandler: () => logoutHandler,
    pauseClearSession: () => {
      clearPause = { started: deferred(), release: deferred() };
      return clearPause;
    },
  };
}

test('request is not refreshed or replayed after the session changes before its 401 response', async () => {
  const harness = loadApiClientHarness();
  const initial = deferred();
  harness.requestResponses.push(initial);

  const request = harness.apiClient('/wallet/transfer', {
    method: 'POST',
    body: { amount: 1 },
  });
  await waitFor(() => harness.fetchCalls.length === 1);

  harness.authState.accessToken = 'access-b';
  harness.authState.refreshToken = 'refresh-b';
  harness.authState.sessionEpoch += 1;
  initial.resolve(response(false, 401, { code: 1, message: 'expired', data: null }));

  await assert.rejects(request, /session changed/i);
  assert.equal(harness.fetchCalls.length, 1);
});

test('same-session request refreshes once and retries with the rotated access token', async () => {
  const harness = loadApiClientHarness();
  harness.requestResponses.push(
    { promise: Promise.resolve(response(false, 401, { code: 1, message: 'expired', data: null })) },
    { promise: Promise.resolve(response(true, 200, { code: 0, message: 'ok', data: { sent: true } })) },
  );
  harness.refreshResponses.push({
    promise: Promise.resolve(
      response(true, 200, {
        code: 0,
        message: 'ok',
        data: { accessToken: 'access-a-next', refreshToken: 'refresh-a-next' },
      }),
    ),
  });

  const epochBefore = harness.authState.sessionEpoch;
  const result = await harness.apiClient('/wallet/transfer', {
    method: 'POST',
    body: { amount: 1 },
  });

  assert.equal(result.sent, true);
  assert.equal(harness.authState.sessionEpoch, epochBefore);
  assert.equal(harness.fetchCalls.length, 3);
  assert.equal(
    harness.fetchCalls[2][1].headers.Authorization,
    'Bearer access-a-next',
  );
});

test('concurrent requests in the same session share one refresh before retrying', async () => {
  const harness = loadApiClientHarness();
  const refresh = deferred();
  harness.refreshResponses.push(refresh);
  harness.requestResponses.push(
    { promise: Promise.resolve(response(false, 401, { code: 1, message: 'expired', data: null })) },
    { promise: Promise.resolve(response(false, 401, { code: 1, message: 'expired', data: null })) },
    { promise: Promise.resolve(response(true, 200, { code: 0, message: 'ok', data: { request: 1 } })) },
    { promise: Promise.resolve(response(true, 200, { code: 0, message: 'ok', data: { request: 2 } })) },
  );

  const first = harness.apiClient('/wallet/first');
  const second = harness.apiClient('/wallet/second');
  await waitFor(
    () =>
      harness.fetchCalls.filter(([url]) => String(url).endsWith('/auth/refresh'))
        .length === 1,
  );

  refresh.resolve(
    response(true, 200, {
      code: 0,
      message: 'ok',
      data: { accessToken: 'access-a-next', refreshToken: 'refresh-a-next' },
    }),
  );

  assert.equal((await first).request, 1);
  assert.equal((await second).request, 2);
  assert.equal(
    harness.fetchCalls.filter(([url]) => String(url).endsWith('/auth/refresh'))
      .length,
    1,
  );
});

test('stale successful refresh cannot overwrite tokens after the active session changes', async () => {
  const harness = loadApiClientHarness();
  const refresh = deferred();
  harness.refreshResponses.push(refresh);

  const request = harness.apiClient('/profile/me');
  await waitFor(() => harness.fetchCalls.length === 2);

  harness.authState.accessToken = 'access-b';
  harness.authState.refreshToken = 'refresh-b';
  harness.authState.sessionEpoch += 1;
  refresh.resolve(
    response(true, 200, {
      code: 0,
      message: 'ok',
      data: { accessToken: 'access-a-next', refreshToken: 'refresh-a-next' },
    }),
  );

  await assert.rejects(request, /session changed/i);
  assert.deepEqual(harness.setTokenCalls, []);
  assert.equal(harness.getClearCalls(), 0);
  assert.equal(harness.authState.accessToken, 'access-b');
  assert.equal(harness.authState.refreshToken, 'refresh-b');
});

test('stale failed refresh does not clear a newer active session', async () => {
  const harness = loadApiClientHarness();
  const refresh = deferred();
  harness.refreshResponses.push(refresh);

  const request = harness.apiClient('/profile/me');
  await waitFor(() => harness.fetchCalls.length === 2);

  harness.authState.accessToken = 'access-b';
  harness.authState.refreshToken = 'refresh-b';
  harness.authState.sessionEpoch += 1;
  refresh.resolve(
    response(false, 500, { code: 1, message: 'refresh down', data: null }),
  );

  await assert.rejects(request);
  assert.equal(harness.getClearCalls(), 0);
  assert.equal(harness.authState.accessToken, 'access-b');
  assert.equal(harness.authState.refreshToken, 'refresh-b');
});

test('refresh failure cannot clear a newer session after asynchronous logout teardown', async () => {
  const harness = loadApiClientHarness();
  const clearPause = harness.pauseClearSession();
  harness.refreshResponses.push({
    promise: Promise.resolve(
      response(false, 500, { code: 1, message: 'refresh down', data: null }),
    ),
  });

  const request = harness.apiClient('/profile/me');
  await clearPause.started.promise;

  harness.authState.accessToken = 'access-b';
  harness.authState.refreshToken = 'refresh-b';
  harness.authState.sessionEpoch += 1;
  clearPause.release.resolve();

  await assert.rejects(request);
  assert.equal(harness.authState.accessToken, 'access-b');
  assert.equal(harness.authState.refreshToken, 'refresh-b');
  assert.equal(harness.authState.sessionEpoch, 2);
});

test('missing refresh token cannot clear a newer session after asynchronous logout teardown', async () => {
  const harness = loadApiClientHarness();
  const clearPause = harness.pauseClearSession();
  harness.authState.refreshToken = null;

  const request = harness.apiClient('/profile/me');
  await clearPause.started.promise;

  harness.authState.accessToken = 'access-b';
  harness.authState.refreshToken = 'refresh-b';
  harness.authState.sessionEpoch += 1;
  clearPause.release.resolve();

  await assert.rejects(request);
  assert.equal(harness.authState.accessToken, 'access-b');
  assert.equal(harness.authState.refreshToken, 'refresh-b');
  assert.equal(harness.authState.sessionEpoch, 2);
});

test('logout handler drops an in-flight refresh singleton so the next session can refresh independently', async () => {
  const harness = loadApiClientHarness();
  const oldRefresh = deferred();
  const newRefresh = deferred();
  harness.refreshResponses.push(oldRefresh, newRefresh);

  const oldRequest = harness.apiClient('/profile/me');
  await waitFor(() => harness.fetchCalls.length === 2);

  const logoutHandler = harness.getLogoutHandler();
  assert.equal(typeof logoutHandler, 'function');
  logoutHandler();
  harness.authState.accessToken = 'access-b';
  harness.authState.refreshToken = 'refresh-b';
  harness.authState.sessionEpoch += 1;

  const newRequest = harness.apiClient('/wallet');
  await waitFor(
    () =>
      harness.fetchCalls.filter(([url]) => String(url).endsWith('/auth/refresh'))
        .length === 2,
  );

  oldRefresh.resolve(
    response(true, 200, {
      code: 0,
      message: 'ok',
      data: { accessToken: 'access-a-next', refreshToken: 'refresh-a-next' },
    }),
  );
  await assert.rejects(oldRequest, /session changed/i);

  const thirdRequest = harness.apiClient('/wallet/third');
  await waitFor(() => harness.fetchCalls.length >= 5);
  assert.equal(
    harness.fetchCalls.filter(([url]) => String(url).endsWith('/auth/refresh'))
      .length,
    2,
  );

  newRefresh.resolve(
    response(true, 200, {
      code: 0,
      message: 'ok',
      data: { accessToken: 'access-b-next', refreshToken: 'refresh-b-next' },
    }),
  );

  await assert.rejects(newRequest);
  await assert.rejects(thirdRequest);
  assert.equal(harness.setTokenCalls.length, 1);
  assert.equal(harness.setTokenCalls[0].accessToken, 'access-b-next');
  assert.equal(harness.setTokenCalls[0].refreshToken, 'refresh-b-next');
});

test('a newer session bypasses an older refresh singleton without resetting it', async () => {
  const harness = loadApiClientHarness();
  const oldRefresh = deferred();
  const newRefresh = deferred();
  harness.refreshResponses.push(oldRefresh, newRefresh);

  const oldRequest = harness.apiClient('/profile/me');
  await waitFor(
    () =>
      harness.fetchCalls.filter(([url]) => String(url).endsWith('/auth/refresh'))
        .length === 1,
  );

  harness.authState.accessToken = 'access-b';
  harness.authState.refreshToken = 'refresh-b';
  harness.authState.sessionEpoch += 1;

  const firstNewRequest = harness.apiClient('/wallet/first');
  const secondNewRequest = harness.apiClient('/wallet/second');
  await waitFor(
    () =>
      harness.fetchCalls.filter(([url]) => String(url).endsWith('/auth/refresh'))
        .length === 2,
  );

  assert.equal(
    harness.fetchCalls.filter(([url]) => String(url).endsWith('/auth/refresh'))
      .length,
    2,
  );

  oldRefresh.resolve(
    response(true, 200, {
      code: 0,
      message: 'ok',
      data: { accessToken: 'access-a-next', refreshToken: 'refresh-a-next' },
    }),
  );
  await assert.rejects(oldRequest, /session changed/i);

  newRefresh.resolve(
    response(true, 200, {
      code: 0,
      message: 'ok',
      data: { accessToken: 'access-b-next', refreshToken: 'refresh-b-next' },
    }),
  );

  await assert.rejects(firstNewRequest);
  await assert.rejects(secondNewRequest);
  assert.equal(harness.setTokenCalls.length, 1);
  assert.equal(harness.setTokenCalls[0].accessToken, 'access-b-next');
});
