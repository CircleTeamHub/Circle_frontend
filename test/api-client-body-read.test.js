const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// 可控定时器:让测试自己决定「15s 到了」,并观察定时器有没有被提前解除。
function makeFakeTimers() {
  let pending = null;
  return {
    setTimeout: (fn) => {
      pending = fn;
      return 42;
    },
    clearTimeout: () => {
      pending = null;
    },
    isArmed: () => pending !== null,
    fire: () => {
      if (!pending) {
        throw new Error('没有 armed 的定时器可触发');
      }
      const fn = pending;
      pending = null;
      fn();
    },
  };
}

// 响应体读取失败(res.text() reject)时 client.ts 的行为。
function loadApiClient({
  textError,
  status = 200,
  ok = true,
  responseText = '',
  onReport = () => {},
  timers,
  hangBody = false,
  onBodyRead,
}) {
  return loadTsModule('src/services/api/client.ts', {
    context: {
      __DEV__: false,
      AbortController,
      ArrayBuffer,
      Blob,
      FormData,
      URL,
      URLSearchParams,
      setTimeout: timers ? timers.setTimeout : setTimeout,
      clearTimeout: timers ? timers.clearTimeout : clearTimeout,
      // headers 已到、body 读到一半断流:fetch 已 resolve,失败发生在 res.text()。
      fetch: async (url, options) => ({
        ok,
        status,
        text: async () => {
          onBodyRead?.();
          if (hangBody) {
            // body 流卡住:只有 signal 被 abort 才结束——模拟流式 fetch 的真实行为。
            return new Promise((_, reject) => {
              options.signal.addEventListener('abort', () => {
                const aborted = new Error('Aborted');
                aborted.name = 'AbortError';
                reject(aborted);
              });
            });
          }
          if (textError) {
            throw textError;
          }
          return responseText;
        },
      }),
      console: { log: () => {} },
    },
    requireShim: (request) => {
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
              sessionEpoch: 1,
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
      if (request === '@/utils/redact') {
        return loadTsModule('src/utils/redact.ts');
      }
      if (request === '@/i18n') {
        return {
          __esModule: true,
          default: {
            t: (key, opts) => (opts && opts.defaultValue) || key,
            language: 'zh',
          },
        };
      }
      return require(request);
    },
  });
}

test('apiClient converts a dropped response body into a localized ApiError', async () => {
  const { apiClient } = loadApiClient({
    textError: new TypeError('Network request failed'),
  });

  await assert.rejects(
    () => apiClient('/circle'),
    (err) =>
      err.name === 'ApiError' &&
      err.status === 0 &&
      err.failureKind === 'body-read' &&
      err.message === '网络异常，请确认后端服务已启动',
  );
});

test('apiClient reports a dropped response body to Sentry once, as an ApiError', async () => {
  const reports = [];
  const reported = [];
  const { apiClient } = loadApiClient({
    textError: new TypeError('Network request failed'),
    onReport: (err, ctx) => {
      reported.push(err);
      reports.push(ctx);
    },
  });

  await assert.rejects(() =>
    apiClient('/notification/123/read', { method: 'POST' }),
  );

  assert.equal(reports.length, 1);
  assert.equal(reports[0].status, 0);
  assert.equal(reports[0].failureKind, 'body-read');
  assert.equal(reports[0].endpointPath, '/notification/:id/read');
  assert.equal(reports[0].method, 'POST');
  // 抛出的是 ApiError,上层 `error instanceof ApiError` 的过滤器才不会二次上报。
  assert.equal(reported[0].name, 'ApiError');
});

test('apiClient maps an aborted response body read to the timeout failure kind', async () => {
  const abortError = new Error('Aborted');
  abortError.name = 'AbortError';
  const { apiClient } = loadApiClient({ textError: abortError });

  await assert.rejects(
    () => apiClient('/circle'),
    (err) =>
      err.name === 'ApiError' &&
      err.status === 0 &&
      err.failureKind === 'timeout' &&
      err.message === '请求超时，请检查网络连接后重试',
  );
});

// AbortError 未必是 Error 实例(某些运行时是 DOMException)。用裸对象钉住 name 判定,
// 换回 `instanceof Error && name === 'AbortError'` 时这条会挂。
test('apiClient treats a non-Error AbortError as a timeout', async () => {
  const { apiClient } = loadApiClient({ textError: { name: 'AbortError' } });

  await assert.rejects(
    () => apiClient('/circle'),
    (err) => err.name === 'ApiError' && err.failureKind === 'timeout',
  );
});

// 15s 定时器必须罩住 body 读:流式 fetch(web)下 fetch 只等到 headers,body 还在传。
// fetch 一 resolve 就 clearTimeout,等于 body 读没有任何上限——卡住的流会永久挂起。
test('the request timeout still covers the response body read', async () => {
  const timers = makeFakeTimers();
  let armedDuringBodyRead = null;
  const { apiClient } = loadApiClient({
    timers,
    hangBody: true,
    onBodyRead: () => {
      armedDuringBodyRead = timers.isArmed();
    },
  });

  const pending = apiClient('/circle');
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(
    armedDuringBodyRead,
    true,
    'body 读期间定时器必须仍然 armed,否则卡住的 body 流没有任何超时上限',
  );

  timers.fire(); // 15s 到

  await assert.rejects(
    () => pending,
    (err) =>
      err.name === 'ApiError' &&
      err.status === 0 &&
      err.failureKind === 'timeout',
  );
});

test('apiClient still surfaces a readable body unchanged', async () => {
  const { apiClient } = loadApiClient({
    responseText: JSON.stringify({ code: 0, message: 'ok', data: { id: 7 } }),
  });

  // 逐字段断言:payload 由 vm realm 内的 JSON.parse 产生,deepStrictEqual 会因原型跨 realm 不同而失败。
  assert.equal((await apiClient('/circle')).id, 7);
});
