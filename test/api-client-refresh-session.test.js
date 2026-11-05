const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { loadTsModule } = require('./helpers/load-ts-module');

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

function loadApiClientHarness({ persistError = false } = {}) {
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
  const diagnostics = [];
  const reports = [];
  const persisted = [];
  let clearCalls = 0;
  const clearOptions = [];
  let clearPause = null;
  let logoutHandler = null;
  const authState = {
    accessToken: 'access-a',
    refreshToken: 'refresh-a',
    isAuthenticated: true,
    refreshUncertain: false,
    sessionEpoch: 1,
    setTokens: (tokens) => {
      setTokenCalls.push(tokens);
      authState.accessToken = tokens.accessToken;
      authState.refreshToken = tokens.refreshToken;
      authState.refreshUncertain = false;
    },
    markRefreshUncertain: async () => {
      authState.refreshUncertain = true;
      if (persistError) throw new Error('fixture storage failure');
      persisted.push({ refreshUncertain: true });
    },
  };

  async function clearLocalSession(expectedSessionEpoch, options) {
    clearCalls += 1;
    clearOptions.push(options);
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
    authState.isAuthenticated = false;
    authState.refreshUncertain = false;
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
        // `{ error }` 模拟 fetch 本身抛错（断网 / DNS 失败），走 client.ts 的
        // network 分支；`{ promise }` 才是拿到了 HTTP 响应。
        if (next.error) throw next.error;
        return next.promise;
      }
      const next = requestResponses.shift();
      return next
        ? next.promise
        : response(false, 401, { code: 1, message: 'expired', data: null });
    },
    require: (request) => {
      if (request === '@/observability/http-diagnostics') {
        return loadTsModule('src/observability/http-diagnostics.ts');
      }
      if (request === '@/utils/client-diagnostics') {
        return { logClientDiagnostic() {} };
      }
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
          reportError: (error, context) => reports.push({ message: error.message, data: error.data, context }),
          shouldReportHttpFailure: () => false,
        };
      }
      if (request === '@/observability/session-diagnostics') return {
        recordSessionDiagnostic: (reason, context) => {
          diagnostics.push({ reason, context });
          return '12345678-1234-4234-8234-123456789def';
        },
      };
      if (request === '@/i18n') {
        return {
          __esModule: true,
          default: {
            t: (_key, opts) => opts?.defaultValue ?? _key,
            language: 'zh',
          },
        };
      }
      if (request === './api-error') {
        // ApiError 的定义搬去了零依赖的 api-error.ts；装真模块，别在这里手抄。
        return loadTsModule('src/services/api/api-error.ts');
      }
      if (request === '@/utils/redact') {
        return loadTsModule('src/utils/redact.ts');
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
    diagnostics,
    reports,
    persisted,
    getClearCalls: () => clearCalls,
    getClearOptions: () => clearOptions,
    getLogoutHandler: () => logoutHandler,
    pauseClearSession: () => {
      clearPause = { started: deferred(), release: deferred() };
      return clearPause;
    },
  };
}

test('wrong current password is a business error and never refreshes or clears a valid session', async () => {
  const harness = loadApiClientHarness();
  harness.requestResponses.push({ promise: Promise.resolve(response(false, 401, { code: 1, message: 'incorrect password', errorCode: 'AUTH_PASSWORD_INCORRECT', data: null })) });
  await assert.rejects(harness.apiClient('/auth/change-password', { method: 'POST', body: { oldPassword: 'wrong', newPassword: 'new-password' } }), error => error.errorCode === 'AUTH_PASSWORD_INCORRECT');
  assert.equal(harness.fetchCalls.length, 1);
  assert.equal(harness.getClearCalls(), 0);
  assert.equal(harness.authState.accessToken, 'access-a');
});

test('a wrong password after token refresh does not clear the refreshed session', async () => {
  const harness = loadApiClientHarness();
  harness.requestResponses.push(
    { promise: Promise.resolve(response(false, 401, { code: 1, message: 'expired', data: null })) },
    { promise: Promise.resolve(response(false, 401, { code: 1, message: 'incorrect password', errorCode: 'AUTH_PASSWORD_INCORRECT', data: null })) },
  );
  harness.refreshResponses.push({ promise: Promise.resolve(response(true, 200, { code: 0, message: 'ok', data: { accessToken: 'next-access', refreshToken: 'next-refresh' } })) });
  await assert.rejects(harness.apiClient('/auth/email/change', { method: 'POST', body: { password: 'wrong' } }), error => error.errorCode === 'AUTH_PASSWORD_INCORRECT');
  assert.equal(harness.fetchCalls.length, 3);
  assert.equal(harness.getClearCalls(), 0);
  assert.equal(harness.authState.accessToken, 'next-access');
});

test('email changes still recover an ordinarily expired access token', async () => {
  const harness = loadApiClientHarness();
  harness.requestResponses.push(
    { promise: Promise.resolve(response(false, 401, { code: 1, message: 'expired', data: null })) },
    { promise: Promise.resolve(response(true, 200, { code: 0, message: 'ok', data: null })) },
  );
  harness.refreshResponses.push({ promise: Promise.resolve(response(true, 200, { code: 0, message: 'ok', data: { accessToken: 'next-access', refreshToken: 'next-refresh' } })) });
  await harness.apiClient('/auth/email/change-request', { method: 'POST', body: { email: 'new@example.com', password: 'correct' } });
  assert.equal(harness.fetchCalls.length, 3);
  assert.equal(harness.getClearCalls(), 0);
});

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
  const attemptIds = harness.fetchCalls.map(([, options]) => options.headers['X-Request-Id']);
  assert.equal(new Set(attemptIds).size, 3);
  for (const id of attemptIds) assert.match(id, /^[0-9a-f-]{36}$/i);
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
      response(false, 401, { code: 1, message: 'refresh rejected', data: null }),
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

// P0-12a: 只有「服务端明确否认 refresh token」才是登出信号。刷新遇到 5xx / 断网 /
// 超时时清 session，等于让后端抖一下就把所有在线用户踢下线。
test('same-session refresh rejected with 401 clears the active local session', async () => {
  const harness = loadApiClientHarness();
  const refresh = deferred();
  harness.refreshResponses.push(refresh);

  const request = harness.apiClient('/profile/me');
  await waitFor(() => harness.fetchCalls.length === 2);

  refresh.resolve(
    response(false, 401, { code: 1, message: 'refresh token expired', data: null }),
  );

  await assert.rejects(request);
  assert.equal(harness.getClearCalls(), 1);
  assert.equal(harness.authState.accessToken, null);
  assert.equal(harness.authState.refreshToken, null);
});

test('same-session refresh rejected with 403 clears the active local session', async () => {
  const harness = loadApiClientHarness();
  harness.refreshResponses.push({
    promise: Promise.resolve(
      response(false, 403, { code: 1, message: 'refresh token revoked', data: null }),
    ),
  });

  await assert.rejects(harness.apiClient('/profile/me'));
  assert.equal(harness.getClearCalls(), 1);
  assert.equal(harness.authState.accessToken, null);
});

test('same-session refresh failing with 5xx keeps the session instead of logging out', async () => {
  const harness = loadApiClientHarness();
  const refresh = deferred();
  harness.refreshResponses.push(refresh);

  const request = harness.apiClient('/profile/me');
  await waitFor(() => harness.fetchCalls.length === 2);

  refresh.resolve(
    response(false, 500, { code: 1, message: 'refresh down', data: null }),
  );

  await assert.rejects(request);
  assert.equal(harness.getClearCalls(), 0);
  assert.equal(harness.authState.accessToken, 'access-a');
  assert.equal(harness.authState.refreshToken, 'refresh-a');
  assert.equal(harness.authState.sessionEpoch, 1);
});

test('same-session refresh failing on a network error keeps the session', async () => {
  const harness = loadApiClientHarness();
  harness.refreshResponses.push({
    error: new TypeError('Network request failed'),
  });

  const request = harness.apiClient('/profile/me');

  await assert.rejects(request, (error) => {
    assert.equal(error.status, 0);
    assert.equal(error.failureKind, 'network');
    return true;
  });
  assert.equal(harness.getClearCalls(), 0);
  assert.equal(harness.authState.accessToken, 'access-a');
  assert.equal(harness.authState.refreshToken, 'refresh-a');
});

test('a transient refresh failure does not stop the next request from refreshing', async () => {
  const harness = loadApiClientHarness();
  harness.refreshResponses.push(
    { error: new TypeError('Network request failed') },
    {
      promise: Promise.resolve(
        response(true, 200, {
          code: 0,
          message: 'ok',
          data: { accessToken: 'access-a-next', refreshToken: 'refresh-a-next' },
        }),
      ),
    },
  );
  harness.requestResponses.push(
    { promise: Promise.resolve(response(false, 401, { code: 1, message: 'expired', data: null })) },
    { promise: Promise.resolve(response(false, 401, { code: 1, message: 'expired', data: null })) },
    { promise: Promise.resolve(response(true, 200, { code: 0, message: 'ok', data: { ok: true } })) },
  );

  // 网络抖动那次刷新失败，但会话必须留着 —— 网络恢复后的下一个请求应当能正常刷新并成功。
  await assert.rejects(harness.apiClient('/profile/me'));
  assert.equal(harness.getClearCalls(), 0);

  const recovered = await harness.apiClient('/profile/me');
  assert.equal(recovered.ok, true);
  assert.equal(harness.authState.accessToken, 'access-a-next');
  assert.equal(harness.authState.sessionEpoch, 1);
});

test('refresh returning a malformed token pair preserves the session and records the anomaly', async () => {
  const harness = loadApiClientHarness();
  harness.refreshResponses.push({
    promise: Promise.resolve(
      response(true, 201, {
        code: 0,
        message: 'ok',
        data: { accessToken: 'only-half-a-pair' },
      }),
    ),
  });

  await assert.rejects(harness.apiClient('/profile/me'), (error) => {
    assert.equal(error.status, 201);
    assert.equal(error.failureKind, 'refresh-response-invalid');
    assert.equal(error.reportEndpoint, '/auth/refresh');
    assert.equal(error.reportMethod, 'POST');
    assert.equal(error.requestId, harness.fetchCalls[1][1].headers['X-Request-Id']);
    assert.ok(Number.isFinite(error.durationMs) && error.durationMs >= 0);
    return true;
  });
  assert.equal(harness.getClearCalls(), 0);
  assert.equal(harness.authState.accessToken, 'access-a');
  assert.equal(harness.authState.refreshToken, 'refresh-a');
  assert.equal(harness.authState.isAuthenticated, true);
  assert.equal(harness.authState.refreshUncertain, true);
  assert.deepEqual(harness.persisted, [{ refreshUncertain: true }]);
  assert.equal(harness.diagnostics.length, 1);
  const diagnostic = harness.diagnostics[0];
  assert.equal(diagnostic.reason, 'refresh-response-invalid');
  assert.equal(diagnostic.context.status, 201);
  assert.equal(diagnostic.context.responseShape, 'object');
  assert.equal(diagnostic.context.responseHasAccessToken, true);
  assert.equal(diagnostic.context.responseHasRefreshToken, false);
  assert.equal(diagnostic.context.sessionPreserved, true);
  assert.equal(diagnostic.context.requestId, harness.fetchCalls[1][1].headers['X-Request-Id']);
  assert.equal(harness.reports.length, 1);
  assert.equal(harness.reports[0].context.operation, 'session');
  assert.equal(harness.reports[0].context.kind, 'refreshResponseInvalid');
  assert.equal(harness.reports[0].context.diagnosticId, '12345678-1234-4234-8234-123456789def');
  assert.doesNotMatch(JSON.stringify(harness.diagnostics) + JSON.stringify(harness.reports), /only-half-a-pair|access-a|refresh-a/);
});

for (const [label, refresh, shape, failureKind] of [
  ['empty body', { ok: true, status: 201, text: async () => '' }, 'empty', 'refresh-response-invalid'],
  ['JSON null', response(true, 201, null), 'empty', 'refresh-response-invalid'],
  ['array', response(true, 201, { code: 0, message: 'ok', data: [] }), 'array', 'refresh-response-invalid'],
  ['primitive', response(true, 201, { code: 0, message: 'ok', data: 'PRIVATE_BODY' }), 'primitive', 'refresh-response-invalid'],
  ['invalid JSON', { ok: true, status: 201, text: async () => '{PRIVATE_BODY' }, 'unknown', 'invalid-json'],
  ['body read failure', { ok: true, status: 201, text: async () => { throw new Error('PRIVATE_BODY'); } }, 'unknown', 'body-read'],
  ['error envelope', response(true, 201, { code: 1, message: 'PRIVATE_BODY', data: 'PRIVATE_BODY' }), 'unknown', 'api-code'],
]) {
  test(`uncertain 201 refresh with ${label} is retained, diagnosed once and never replayed automatically`, async () => {
    const h = loadApiClientHarness();
    h.refreshResponses.push({ promise: Promise.resolve(refresh) });
    await assert.rejects(h.apiClient('/profile/me'), error => error.status === 201 && error.failureKind === 'refresh-response-invalid');
    await assert.rejects(h.apiClient('/profile/me'), error => error.failureKind === 'refresh-response-invalid');
    assert.equal(h.fetchCalls.filter(([url]) => url.endsWith('/auth/refresh')).length, 1);
    assert.equal(h.getClearCalls(), 0);
    assert.equal(h.authState.isAuthenticated, true);
    assert.equal(h.authState.accessToken, 'access-a');
    assert.equal(h.authState.refreshToken, 'refresh-a');
    assert.equal(h.diagnostics.length, 1);
    assert.equal(h.reports.length, 1);
    assert.equal(h.diagnostics[0].context.status, 201);
    assert.equal(h.diagnostics[0].context.failureKind, failureKind);
    assert.equal(h.diagnostics[0].context.responseShape, shape);
    assert.doesNotMatch(JSON.stringify(h.diagnostics) + JSON.stringify(h.reports), /PRIVATE_BODY|access-a|refresh-a/);
  });
}

test('a restored uncertain refresh blocks rotation without clearing the cached session', async () => {
  const h = loadApiClientHarness();
  h.authState.refreshUncertain = true;
  await assert.rejects(h.refreshSessionAccessToken(), error => error.failureKind === 'refresh-response-invalid');
  assert.equal(h.fetchCalls.length, 0);
  assert.equal(h.getClearCalls(), 0);
  h.requestResponses.push({ promise: Promise.resolve(response(true, 200, { code: 0, message: 'ok', data: { ok: true } })) });
  assert.equal((await h.apiClient('/profile/me')).ok, true);
  assert.equal(h.fetchCalls.length, 1, 'an access token which still works remains usable');
});

test('concurrent REST and proactive refresh failures produce one preserved-session incident', async () => {
  const h = loadApiClientHarness();
  const pending = deferred();
  h.refreshResponses.push(pending);
  const results = Promise.allSettled([h.apiClient('/profile/me'), h.apiClient('/auth/me'), h.refreshSessionAccessToken()]);
  await waitFor(() => h.fetchCalls.length === 3);
  pending.resolve(response(true, 201, null));
  for (const result of await results) {
    assert.equal(result.status, 'rejected');
    assert.equal(result.reason.failureKind, 'refresh-response-invalid');
  }
  assert.equal(h.fetchCalls.filter(([url]) => url.endsWith('/auth/refresh')).length, 1);
  assert.equal(h.diagnostics.length, 1);
  assert.equal(h.reports.length, 1);
  assert.equal(h.getClearCalls(), 0);
});

test('fresh valid credentials recover an uncertain session and allow subsequent rotation', async () => {
  const h = loadApiClientHarness();
  h.authState.refreshUncertain = true;
  h.authState.setTokens({ accessToken: 'fresh-access', refreshToken: 'fresh-refresh' });
  h.refreshResponses.push({ promise: Promise.resolve(response(true, 201, { code: 0, message: 'ok', data: { accessToken: 'next-access', refreshToken: 'next-refresh' } })) });
  assert.equal(await h.refreshSessionAccessToken(), 'next-access');
  assert.equal(JSON.parse(h.fetchCalls[0][1].body).refreshToken, 'fresh-refresh');
  assert.equal(h.getClearCalls(), 0);
});

test('a malformed late refresh cannot quarantine or report against a newer login', async () => {
  const h = loadApiClientHarness();
  const pending = deferred();
  h.refreshResponses.push({ promise: pending.promise });
  const request = h.apiClient('/profile/me');
  await waitFor(() => h.fetchCalls.length === 2);
  h.authState.sessionEpoch += 1;
  h.authState.setTokens({ accessToken: 'new-login-access', refreshToken: 'new-login-refresh' });
  pending.resolve(response(true, 201, null));
  await assert.rejects(request, error => error.failureKind === 'session-changed');
  assert.equal(h.authState.refreshUncertain, false);
  assert.equal(h.authState.accessToken, 'new-login-access');
  assert.equal(h.diagnostics.length, 0);
  assert.equal(h.reports.length, 0);
  assert.equal(h.getClearCalls(), 0);
});

test('uncertain refresh keeps memory and local diagnostics when auth persistence fails', async () => {
  const h = loadApiClientHarness({ persistError: true });
  h.refreshResponses.push({ promise: Promise.resolve(response(true, 201, null)) });
  await assert.rejects(h.refreshSessionAccessToken(), error => error.failureKind === 'refresh-response-invalid');
  assert.equal(h.authState.refreshUncertain, true);
  assert.equal(h.authState.isAuthenticated, true);
  assert.equal(h.diagnostics.length, 1);
  assert.equal(h.getClearCalls(), 0);
});

test('a request rejected after a successful refresh retains the retry request id in logout diagnostics', async () => {
  const harness = loadApiClientHarness();
  harness.refreshResponses.push({ promise: Promise.resolve(response(true, 201, {
    code: 0, message: 'ok', data: { accessToken: 'access-next', refreshToken: 'refresh-next' },
  })) });
  harness.requestResponses.push(
    { promise: Promise.resolve(response(false, 401, { code: 1, message: 'expired', data: null })) },
    { promise: Promise.resolve(response(false, 401, { code: 1, message: 'revoked', data: null })) },
  );
  await assert.rejects(harness.apiClient('/auth/me'));
  assert.equal(harness.getClearCalls(), 1);
  const details = harness.getClearOptions()[0];
  assert.equal(details?.reason, 'request-rejected-after-refresh');
  assert.equal(details?.endpointPath, '/auth/me');
  assert.equal(details?.status, 401);
  assert.equal(details?.requestId, harness.fetchCalls[2][1].headers['X-Request-Id']);
});

test('isDefinitiveAuthFailure only treats a server auth verdict as a logout signal', () => {
  const { isDefinitiveAuthFailure, ApiError } = loadApiClientHarness();

  assert.equal(isDefinitiveAuthFailure(new ApiError('unauthorized', { status: 401 })), true);
  assert.equal(isDefinitiveAuthFailure(new ApiError('forbidden', { status: 403 })), true);

  assert.equal(
    isDefinitiveAuthFailure(
      new ApiError('timeout', { status: 0, failureKind: 'timeout' }),
    ),
    false,
  );
  assert.equal(
    isDefinitiveAuthFailure(
      new ApiError('offline', { status: 0, failureKind: 'network' }),
    ),
    false,
  );
  assert.equal(isDefinitiveAuthFailure(new ApiError('bad gateway', { status: 502 })), false);
  assert.equal(
    isDefinitiveAuthFailure(
      new ApiError('html error page', { status: 200, failureKind: 'invalid-json' }),
    ),
    false,
  );
  // 会话已被换掉是本地信号，不是服务端对凭证的结论。
  assert.equal(
    isDefinitiveAuthFailure(
      new ApiError('session changed', { status: 401, failureKind: 'session-changed' }),
    ),
    false,
  );
  assert.equal(isDefinitiveAuthFailure(new Error('boom')), false);
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

test('settled stale refresh cleanup does not drop a newer in-flight refresh promise', async () => {
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

  const thirdRequest = harness.apiClient('/settings');
  await waitFor(() =>
    harness.fetchCalls.some(([url]) => String(url).endsWith('/settings')),
  );
  await Promise.resolve();

  newRefresh.resolve(
    response(true, 200, {
      code: 0,
      message: 'ok',
      data: { accessToken: 'access-b-next', refreshToken: 'refresh-b-next' },
    }),
  );

  await assert.rejects(newRequest);
  await assert.rejects(thirdRequest);
  assert.equal(
    harness.fetchCalls.filter(([url]) => String(url).endsWith('/auth/refresh'))
      .length,
    2,
  );
  assert.equal(harness.setTokenCalls.length, 1);
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

test('refresh carries the stable device id; ordinary requests do not', async () => {
  const harness = loadApiClientHarness();
  harness.registerDeviceIdProvider(async () => 'legacy-random-id-0001');
  harness.registerStableDeviceIdProvider(async () => `a1-${'ab'.repeat(32)}`);
  harness.requestResponses.push(
    { promise: Promise.resolve(response(false, 401, { code: 1, message: 'expired', data: null })) },
    { promise: Promise.resolve(response(true, 200, { code: 0, message: 'ok', data: { ok: true } })) },
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

  await harness.apiClient('/wallet/balance');

  const [first, refresh, retry] = harness.fetchCalls.map(([, options]) => options.headers);
  assert.equal(refresh['X-Device-Id'], 'legacy-random-id-0001');
  assert.equal(refresh['X-Stable-Device-Id'], `a1-${'ab'.repeat(32)}`);
  assert.equal(first['X-Stable-Device-Id'], undefined);
  assert.equal(retry['X-Stable-Device-Id'], undefined);
});

test('a stalled stable-device lookup cannot hold the refresh back', async () => {
  const harness = loadApiClientHarness();
  harness.registerDeviceIdProvider(async () => 'legacy-random-id-0001');
  // 原生取 ANDROID_ID / 摘要卡住：续签要照发，只是这次不带稳定 ID。
  harness.registerStableDeviceIdProvider(() => new Promise(() => {}));
  harness.requestResponses.push(
    { promise: Promise.resolve(response(false, 401, { code: 1, message: 'expired', data: null })) },
    { promise: Promise.resolve(response(true, 200, { code: 0, message: 'ok', data: { ok: true } })) },
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

  const result = await harness.apiClient('/wallet/balance');

  assert.equal(result.ok, true);
  const refresh = harness.fetchCalls.find(([url]) => String(url).endsWith('/auth/refresh'));
  assert.ok(refresh, 'refresh was sent');
  assert.equal(refresh[1].headers['X-Stable-Device-Id'], undefined);
});
