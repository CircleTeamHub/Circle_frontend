const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadApiClient({
  responseText,
  responses,
  logs = [],
  status = 201,
  ok = true,
  onReport = () => {},
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
    __DEV__: true,
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
      const next = responseQueue?.shift() ?? { ok, status, responseText };
      return {
        ok: next.ok,
        status: next.status,
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
  assert.equal(JSON.stringify(reports[0].queryKeys), JSON.stringify(['accountId']));
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
