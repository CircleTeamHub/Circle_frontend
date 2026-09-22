const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { loadTsModule } = require('./helpers/load-ts-module');

function loadApiClient({
  responseText,
  responses,
  logs = [],
  status = 201,
  ok = true,
  onReport = () => {},
  dev = true,
  onFetch,
  diagnostics,
  now = () => Date.now(),
  sessionState = {},
}) {
  const filePath = path.join(process.cwd(), 'src/services/api/client.ts');
  const source = fs.readFileSync(filePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;

  const responseQueue = responses ? [...responses] : null;
  const fetchCalls = [];
  const context = {
    module: { exports: {} },
    exports: {},
    __DEV__: dev,
    AbortController,
    ArrayBuffer,
    Blob,
    FormData,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    Date: class extends Date { static now() { return now(); } },
    fetch: async (url, options) => {
      fetchCalls.push([url, options]);
      if (onFetch) return onFetch(url, options);
      const next = responseQueue?.shift() ?? { ok, status, responseText };
      return {
        ok: next.ok,
        status: next.status,
        headers: new Headers(next.headers),
        text: async () => next.responseText,
      };
    },
    console: {
      log: (...args) => logs.push(args),
    },
    require: (request) => {
      if (request === '@/constants/config') {
        return { API_URL: 'http://192.168.1.65:3000/api/v1' };
      }
      if (request === '@/services/auth/session') {
        return {
          clearLocalSession: async () => {},
          registerLogoutHandler: () => () => {},
        };
      }
      if (request === '@/stores/authStore') {
        return {
          useAuthStore: {
            getState: () => ({
              accessToken: 'access-token',
              refreshToken: 'refresh-token',
              setTokens: () => {},
              ...sessionState,
            }),
          },
        };
      }
      if (request === '@/observability/sentry') {
        return {
          reportError: onReport,
          shouldReportHttpFailure: (s) => s === undefined || s === 0 || s >= 500,
        };
      }
      if (request === './api-error') {
        // ApiError 的定义搬去了零依赖的 api-error.ts；装真模块，别在这里手抄。
        return loadTsModule('src/services/api/api-error.ts');
      }
      if (request === '@/observability/http-diagnostics') {
        return loadTsModule('src/observability/http-diagnostics.ts', {
          requireShim: (name) => name === 'expo-crypto' ? require('node:crypto') : require(name),
        });
      }
      if (request === '@/utils/client-diagnostics') {
        return diagnostics ?? { logClientDiagnostic: () => {} };
      }
      if (request === '@/utils/redact') {
        // 真模块，不是 stub：脱敏就是这几个断言要验的东西，换成假的等于不测。
        return loadTsModule('src/utils/redact.ts');
      }
      if (request === '@/i18n') {
        // client.ts i18n's its user-facing error messages; echo defaultValue (+ {{}} interp).
        return {
          __esModule: true,
          default: {
            t: (key, opts) => { let s = (opts && opts.defaultValue) || key; if (opts) for (const k of Object.keys(opts)) if (k !== 'defaultValue') s = s.split('{{' + k + '}}').join(String(opts[k])); return s; },
            language: 'zh',
          },
        };
      }
      return require(request);
    },
  };
  context.exports = context.module.exports;

  vm.runInNewContext(transpiled, context, { filename: filePath });
  return { ...context.module.exports, fetchCalls };
}

test('api dev logs redact presigned upload URLs and object keys', async () => {
  const logs = [];
  const { apiClient } = loadApiClient({
    logs,
    responseText: JSON.stringify({
      code: 0,
      message: 'ok',
      data: {
        uploadUrl:
          'http://192.168.1.65:9000/circle/chat/user/file.heic?X-Amz-Signature=secret',
        fileUrl: 'http://192.168.1.65:9000/circle/chat/user/file.heic',
        key: 'chat/user/file.heic',
      },
    }),
  });

  await apiClient('/upload/presign', {
    method: 'POST',
    body: {
      filename: 'file.heic',
      contentType: 'image/heic',
      folder: 'chat',
    },
  });

  const serializedLogs = JSON.stringify(logs);
  assert.doesNotMatch(serializedLogs, /X-Amz-Signature/);
  assert.doesNotMatch(serializedLogs, /circle\/chat\/user\/file\.heic/);
  assert.match(serializedLogs, /\[REDACTED/);
});

test('api dev logs redact push revocation secrets in register and revoke bodies', async () => {
  const logs = [];
  const secret = '12345678-1234-4234-9234-123456789abc';
  const { apiClient } = loadApiClient({
    logs,
    responses: [
      { ok: true, status: 200, responseText: '' },
      { ok: true, status: 200, responseText: '' },
    ],
  });
  await apiClient('/notification/push-token', {
    method: 'PUT',
    body: { token: 'push-token', revocationSecret: secret },
  });
  await apiClient('/notification/push-token/revoke', {
    method: 'DELETE',
    auth: false,
    body: { token: 'push-token', revocationSecret: secret },
  });
  const serializedLogs = JSON.stringify(logs);
  assert.doesNotMatch(serializedLogs, new RegExp(secret));
  assert.doesNotMatch(serializedLogs, /revocationSecret/);
  assert.match(serializedLogs, /\[REDACTED\]/);
});

test('apiClient reports unexpected 5xx failures to Sentry', async () => {
  const reports = [];
  const { apiClient } = loadApiClient({
    status: 500,
    ok: false,
    responseText: JSON.stringify({
      code: 1,
      message: 'boom',
      errorCode: 'CIRCLE_MEMBER_LIMIT',
      data: null,
    }),
    onReport: (_err, ctx) => reports.push(ctx),
  });

  await assert.rejects(() => apiClient('/circle', { method: 'POST' }));

  assert.equal(reports.length, 1);
  assert.equal(reports[0].status, 500);
  assert.equal(reports[0].endpointPath, '/circle');
  assert.equal(reports[0].method, 'POST');
  assert.equal(reports[0].errorCode, 'CIRCLE_MEMBER_LIMIT');
});

test('apiClient reports sanitized endpoint context to Sentry', async () => {
  const reports = [];
  const { apiClient } = loadApiClient({
    status: 500,
    ok: false,
    responseText: JSON.stringify({ code: 1, message: 'boom', data: null }),
    onReport: (_err, ctx) => reports.push(ctx),
  });

  await assert.rejects(() =>
    apiClient('/user/search/account?accountId=private@example.com'),
  );

  assert.equal(reports.length, 1);
  assert.equal(reports[0].endpointPath, '/user/search/account');
  assert.equal(reports[0].queryKeys, undefined);
  assert.equal(reports[0].endpoint, undefined);
  assert.doesNotMatch(JSON.stringify(reports[0]), /private@example\.com/);
});

test('apiClient does not report expected 4xx errors', async () => {
  const reports = [];
  const { apiClient } = loadApiClient({
    status: 404,
    ok: false,
    responseText: JSON.stringify({ code: 1, message: 'not found', data: null }),
    onReport: (_err, ctx) => reports.push(ctx),
  });

  await assert.rejects(() => apiClient('/circle/missing'));

  assert.equal(reports.length, 0);
});

test('apiClient preserves backend errorCode on non-ok responses', async () => {
  const { apiClient } = loadApiClient({
    status: 400,
    ok: false,
    responseText: JSON.stringify({
      code: 1,
      message: 'invalid level',
      errorCode: 'MEMBERSHIP_INVALID_LEVEL',
      data: null,
    }),
  });

  await assert.rejects(
    () => apiClient('/membership/upgrade', { method: 'POST' }),
    (err) =>
      err.name === 'ApiError' &&
      err.status === 400 &&
      err.errorCode === 'MEMBERSHIP_INVALID_LEVEL',
  );
});

test('apiClient preserves backend errorCode on wrapped api-code failures', async () => {
  const { apiClient } = loadApiClient({
    status: 200,
    ok: true,
    responseText: JSON.stringify({
      code: 1001,
      message: 'not enough points',
      errorCode: 'MEMBERSHIP_INSUFFICIENT_POINTS',
      data: null,
    }),
  });

  await assert.rejects(
    () => apiClient('/membership/upgrade', { method: 'POST' }),
    (err) =>
      err.name === 'ApiError' &&
      err.status === 200 &&
      err.code === 1001 &&
      err.failureKind === 'api-code' &&
      err.errorCode === 'MEMBERSHIP_INSUFFICIENT_POINTS',
  );
});

test('apiClient reports refresh token failures against the refresh endpoint', async () => {
  const reports = [];
  const { apiClient } = loadApiClient({
    responses: [
      {
        ok: false,
        status: 401,
        responseText: JSON.stringify({ code: 1, message: 'expired', data: null }),
      },
      {
        ok: false,
        status: 500,
        responseText: JSON.stringify({ code: 1, message: 'refresh down', data: null }),
      },
    ],
    onReport: (_err, ctx) => reports.push(ctx),
  });

  await assert.rejects(() => apiClient('/circle/123'));

  assert.equal(reports.length, 1);
  assert.equal(reports[0].endpointPath, '/auth/refresh');
  assert.equal(reports[0].method, 'POST');
  assert.equal(reports[0].status, 500);
});

test('apiClient reports malformed successful backend responses as contract failures', async () => {
  const reports = [];
  const { apiClient } = loadApiClient({
    status: 200,
    ok: true,
    responseText: '<html>not json</html>',
    onReport: (_err, ctx) => reports.push(ctx),
  });

  await assert.rejects(() => apiClient('/circle'));

  assert.equal(reports.length, 1);
  assert.equal(reports[0].endpointPath, '/circle');
  assert.equal(reports[0].failureKind, 'invalid-json');
  assert.equal(reports[0].status, 200);
});

test('API diagnostics omit private body, headers, query keys and alphabetic route identifiers', async () => {
  const logs = [];
  const reports = [];
  const { apiClient } = loadApiClient({
    logs,
    status: 500,
    ok: false,
    responseText: JSON.stringify({ code: 1, message: 'private-response', data: { title: 'private-title' } }),
    onReport: (_error, ctx) => reports.push(ctx),
  });
  await assert.rejects(() => apiClient('/circle/privatecircle?privatequery=value', {
    method: 'POST', body: { text: 'private-chat' }, headers: { 'X-Custom': 'private-header' },
    logResponseBody: true,
  }));
  assert.doesNotMatch(JSON.stringify({ logs, reports }), /private(circle|query|response|title|chat|header)/);
  assert.equal(reports[0].endpointPath, '/circle/:id');
});

test('HTTP failures carry the server UUID and duration without changing API results', async () => {
  const reports = [];
  const requestId = '48edcc74-c0ac-4761-a576-12059e796869';
  const { apiClient, fetchCalls } = loadApiClient({
    responses: [{ status: 500, ok: false, headers: { 'X-Request-Id': requestId }, responseText: '{}' }],
    onReport: (_error, ctx) => reports.push(ctx),
  });
  await assert.rejects(() => apiClient('/circle'), (error) => error.requestId === requestId);
  assert.equal(reports[0].requestId, requestId);
  assert.equal(reports[0].failureKind, 'http');
  assert.ok(Number.isFinite(reports[0].durationMs) && reports[0].durationMs >= 0);
  assert.match(fetchCalls[0][1].headers['X-Request-Id'], /^[0-9a-f-]{36}$/i);
});

test('refresh failures use their own per-attempt correlation, never the original request ID', async () => {
  const reports = [];
  const refreshId = 'df632010-728d-4ac7-b30e-a1521ba55d04';
  const { apiClient, fetchCalls } = loadApiClient({
    responses: [
      { status: 401, ok: false, responseText: '{}' },
      { status: 503, ok: false, responseText: '{}', headers: { 'x-request-id': refreshId } },
    ],
    onReport: (_error, ctx) => reports.push(ctx),
  });
  await assert.rejects(() => apiClient('/circle'));
  assert.equal(reports[0].requestId, refreshId);
  assert.notEqual(fetchCalls[0][1].headers['X-Request-Id'], fetchCalls[1][1].headers['X-Request-Id']);
});

test('untrusted response correlation is discarded and production console stays quiet', async () => {
  const logs = [];
  const reports = [];
  const { apiClient, fetchCalls } = loadApiClient({
    dev: false, logs,
    responses: [{ status: 500, ok: false, responseText: '{}', headers: { 'x-request-id': 'private@example.com' } }],
    onReport: (_error, ctx) => reports.push(ctx),
  });
  await assert.rejects(() => apiClient('/circle', { headers: { 'x-request-id': 'caller-private-value' } }));
  assert.equal(logs.length, 0);
  assert.equal(reports[0].requestId, fetchCalls[0][1].headers['X-Request-Id']);
  assert.equal(fetchCalls[0][1].headers['x-request-id'], undefined);
  assert.doesNotMatch(JSON.stringify(reports), /private/);
});

test('a retried request failure reports the retry attempt rather than refresh identity', async () => {
  const reports = [];
  const retryId = '18c6a657-cf01-4aa0-b044-af5bdf20c79a';
  const { apiClient, fetchCalls } = loadApiClient({
    responses: [
      { status: 401, ok: false, responseText: '{}' },
      { status: 200, ok: true, responseText: JSON.stringify({
        code: 0, message: 'ok', data: { accessToken: 'next-access', refreshToken: 'next-refresh' },
      }) },
      { status: 503, ok: false, responseText: '{}', headers: { 'x-request-id': retryId } },
    ],
    onReport: (_error, context) => reports.push(context),
  });
  await assert.rejects(() => apiClient('/circle'), (error) => error.requestId === retryId);
  assert.equal(new Set(fetchCalls.map(([, options]) => options.headers['X-Request-Id'])).size, 3);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].requestId, retryId);
  assert.equal(reports[0].endpointPath, '/circle');
  assert.equal(reports[0].failureKind, 'http');
});

test('network diagnostics omit arbitrary native exception messages', async () => {
  const logs = [];
  const { apiClient } = loadApiClient({
    logs,
    onFetch: async () => { throw new Error('private-chat-body'); },
  });
  await assert.rejects(() => apiClient('/circle'));
  assert.doesNotMatch(JSON.stringify(logs), /private-chat-body/);
});

test('repeated API incidents retain breadcrumbs but bound Sentry volume per minute', async () => {
  const reports = [];
  const breadcrumbs = [];
  let now = 1_000;
  const { apiClient } = loadApiClient({
    dev: false, status: 503, ok: false, responseText: '{}', now: () => now,
    onReport: (_error, ctx) => reports.push(ctx),
    diagnostics: { logClientDiagnostic: (event, details) => breadcrumbs.push({ event, details }) },
  });
  await assert.rejects(() => apiClient('/circle/first-private-id'));
  await assert.rejects(() => apiClient('/circle/second-private-id'));
  assert.equal(reports.length, 1);
  assert.equal(breadcrumbs.length, 2);
  now += 60_000;
  await assert.rejects(() => apiClient('/circle/third-private-id'));
  assert.equal(reports.length, 2);
  assert.equal(breadcrumbs.length, 3);
});

test('diagnostic sink failures do not replace the original API error', async () => {
  const { apiClient } = loadApiClient({
    status: 503, ok: false, responseText: '{}',
    onReport: () => { throw new Error('sentry sink broken'); },
    diagnostics: { logClientDiagnostic: () => { throw new Error('breadcrumb sink broken'); } },
  });
  await assert.rejects(() => apiClient('/circle'), (error) => error.name === 'ApiError' && error.status === 503);
});

test('HTTP route shapes fail closed for unrecognized endpoints and token paths', () => {
  const { safeHttpEndpoint, safeHttpRequestId } = loadTsModule('src/observability/http-diagnostics.ts');
  assert.equal(safeHttpEndpoint('/qr/tokens/private-bearer?secret=true'), '/qr/tokens/:id');
  assert.equal(safeHttpEndpoint('/friend/blocked'), '/friend/blocked');
  assert.equal(safeHttpEndpoint('/friend/blocked/tags/private-tag'), '/friend/:id/tags/:id');
  assert.equal(safeHttpEndpoint('/friend/activities/unread-count'), '/friend/activities/unread-count');
  assert.equal(safeHttpEndpoint('/chat/conversations/private/events'), '/chat/conversations/:id/events');
  assert.equal(safeHttpEndpoint('/chat/conversations/private/sync?after=1'), '/chat/conversations/:id/sync');
  assert.equal(safeHttpEndpoint('/mall/fancy-numbers?page=1'), '/mall/fancy-numbers');
  assert.equal(safeHttpEndpoint('/geo/reverse?lat=1&lon=2'), '/geo/reverse');
  assert.equal(safeHttpEndpoint('/referrals/me'), '/referrals/me');
  assert.equal(safeHttpEndpoint('/unknown/private-path'), '/__other__');
  assert.equal(safeHttpEndpoint('https://example.com/circle/private'), '/__other__');
  assert.equal(safeHttpRequestId('eyJsecret.token.signature'), undefined);
  assert.equal(safeHttpRequestId('00000000-0000-0000-0000-000000000000'), undefined);
});

test('late requests from an old session cannot repopulate the next session diagnostics', async () => {
  const reports = [];
  const breadcrumbs = [];
  const sessionState = { sessionEpoch: 1 };
  const { apiClient } = loadApiClient({
    sessionState, onReport: (error) => reports.push(error),
    diagnostics: { logClientDiagnostic: (...args) => breadcrumbs.push(args) },
    onFetch: async () => {
      sessionState.sessionEpoch = 2;
      return { status: 503, ok: false, text: async () => '{}' };
    },
  });
  await assert.rejects(() => apiClient('/circle'), (error) => error.status === 503);
  assert.equal(reports.length, 0);
  assert.equal(breadcrumbs.length, 0);
});
