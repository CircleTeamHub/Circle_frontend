const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// 2026-11 「选择笔记」转圈：服务器 30ms 内回了、回包也到了手机，请求却在客户端卡住。
// 这里钉住三件事：卡住的 GET 换新请求重试一次；读 body 不认中止信号时也要按时失败；
// 失败上报带上「卡在哪一步」。

// 可控定时器：记下每个定时器的时长，测试自己决定哪个先到点。
function makeTimers() {
  let nextId = 1;
  const pending = new Map();
  const delays = [];
  return {
    delays,
    setTimeout: (fn, ms) => {
      const id = nextId++;
      pending.set(id, { fn, ms });
      delays.push(ms);
      return id;
    },
    clearTimeout: (id) => {
      pending.delete(id);
    },
    // 让到点最早的那个先触发（卡顿检查 8s 早于整段预算 15s）。
    fireSoonest: () => {
      let soonest;
      for (const [id, entry] of pending) {
        if (!soonest || entry.ms < soonest[1].ms) soonest = [id, entry];
      }
      if (!soonest) throw new Error('没有 armed 的定时器可触发');
      pending.delete(soonest[0]);
      soonest[1].fn();
    },
    armed: () => pending.size,
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

function abortError() {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

// RN 的 fetch（whatwg-fetch）在 XHR 完成前被中止时 reject AbortError。
function stalledFetch(options) {
  return new Promise((_, reject) => {
    options.signal.addEventListener('abort', () => reject(abortError()));
  });
}

function okResponse(data) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => JSON.stringify({ code: 0, message: 'ok', data }),
  };
}

function loadClient({ fetchImpl, timers, session = { epoch: 1 } }) {
  const reports = [];
  const calls = [];
  const client = loadTsModule('src/services/api/client.ts', {
    context: {
      __DEV__: false,
      AbortController,
      ArrayBuffer,
      Blob,
      FormData,
      URL,
      URLSearchParams,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      fetch: (url, options) => {
        calls.push({ url, options });
        return fetchImpl(options, calls.length);
      },
      console: { log: () => {} },
    },
    requireShim: (request) => {
      if (request === '@/observability/http-diagnostics') {
        return loadTsModule('src/observability/http-diagnostics.ts');
      }
      if (request === '@/constants/config') {
        return { API_URL: 'https://api.example.test/api/v1' };
      }
      if (request === '@/services/auth/session') {
        return { clearLocalSession: async () => {}, registerLogoutHandler: () => () => {} };
      }
      if (request === '@/stores/authStore') {
        return {
          useAuthStore: {
            getState: () => ({
              accessToken: 'access-token',
              refreshToken: 'refresh-token',
              sessionEpoch: session.epoch,
              setTokens: () => {},
            }),
          },
        };
      }
      if (request === '@/observability/sentry') {
        return {
          reportError: (error, context) => reports.push({ error, context }),
          shouldReportHttpFailure: (s) => s === undefined || s === 0 || s >= 500,
        };
      }
      if (request === '@/utils/client-diagnostics') {
        return { logClientDiagnostic: () => {} };
      }
      if (request === './api-error') {
        return loadTsModule('src/services/api/api-error.ts');
      }
      if (request === '@/utils/redact') {
        return loadTsModule('src/utils/redact.ts');
      }
      if (request === '@/i18n') {
        return { __esModule: true, default: { t: (key, opts) => (opts && opts.defaultValue) || key, language: 'zh' } };
      }
      return require(request);
    },
  });
  return { ...client, reports, calls };
}


// 卡顿检查要靠 request-trace 钩子判断「有没有在收数据」；默认「没动静」。
function traceHooks(overrides = {}) {
  return {
    begin: () => {},
    finish: () => undefined,
    isReceiving: () => false,
    ...overrides,
  };
}

const neverSettles = () => new Promise(() => {});

async function settlesWithin(promise, ms = 200) {
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('请求永远没有结束')), ms));
  return Promise.race([promise, timeout]);
}

test('a GET with no sign of a response at the stall check is retried once on a fresh request', async () => {
  const timers = makeTimers();
  const { apiClient, registerRequestTraceHooks, calls } = loadClient({
    timers,
    fetchImpl: (options, n) => (n === 1 ? stalledFetch(options) : Promise.resolve(okResponse({ id: 7 }))),
  });
  registerRequestTraceHooks(traceHooks());

  const pending = apiClient('/note');
  await tick();
  timers.fireSoonest(); // 8s 卡顿检查

  assert.equal((await pending).id, 7);
  assert.equal(calls.length, 2);
  // 重试是一个新请求：新的 X-Request-Id，服务端日志里两次能分开对账。
  assert.notEqual(calls[0].options.headers['X-Request-Id'], calls[1].options.headers['X-Request-Id']);
  // 第一次：整段预算 + 卡顿检查；重试只用剩下的预算，总耗时不超过原来的 15s。
  assert.deepEqual(timers.delays, [15000, 8000, 7000]);
});

// whatwg-fetch 在 XHR 完成时摘掉中止监听；之后若 resolve 前出错，fetch 本身永远不结束。
test('a GET whose fetch ignores the abort signal is still cut at the stall check and retried', async () => {
  const timers = makeTimers();
  const { apiClient, registerRequestTraceHooks, calls } = loadClient({
    timers,
    fetchImpl: (_options, n) => (n === 1 ? neverSettles() : Promise.resolve(okResponse({ id: 8 }))),
  });
  registerRequestTraceHooks(traceHooks());

  const pending = apiClient('/note');
  await tick();
  timers.fireSoonest();

  assert.equal((await settlesWithin(pending)).id, 8);
  assert.equal(calls.length, 2);
});

test('a slow GET that is still receiving its body is not cut at the stall check', async () => {
  const timers = makeTimers();
  let finishBody;
  const { apiClient, registerRequestTraceHooks, calls } = loadClient({
    timers,
    fetchImpl: () =>
      new Promise((resolve) => {
        finishBody = () => resolve(okResponse({ id: 10 }));
      }),
  });
  registerRequestTraceHooks(traceHooks({ isReceiving: () => true }));

  const pending = apiClient('/note');
  await tick();
  timers.fireSoonest(); // 8s：响应头已到、还在下载 —— 不算卡住
  finishBody(); // 10s 才下完

  assert.equal((await pending).id, 10);
  assert.equal(calls.length, 1);
});

test('without trace hooks a GET keeps the single 15s budget (web)', async () => {
  const timers = makeTimers();
  const { apiClient, calls } = loadClient({
    timers,
    fetchImpl: (options) => stalledFetch(options),
  });

  const pending = apiClient('/note');
  await tick();
  timers.fireSoonest(); // 卡顿检查：看不到进度，不叫停
  await tick();
  assert.equal(calls.length, 1);
  timers.fireSoonest(); // 15s 预算到

  await assert.rejects(pending, (error) => error.failureKind === 'timeout');
  assert.equal(calls.length, 1);
});

test('a recovered stall is reported once, tagged recovered, with the stuck attempt\'s stage', async () => {
  const timers = makeTimers();
  const { apiClient, registerRequestTraceHooks, reports } = loadClient({
    timers,
    fetchImpl: (options, n) => (n === 1 ? stalledFetch(options) : Promise.resolve(okResponse({ id: 7 }))),
  });
  registerRequestTraceHooks(traceHooks({ finish: (_id, failed) => (failed ? { xhrStage: 'acked' } : undefined) }));

  const pending = apiClient('/note');
  await tick();
  timers.fireSoonest();
  await pending;

  assert.equal(reports.length, 1);
  const { context } = reports[0];
  assert.equal(context.endpointPath, '/note');
  assert.equal(context.failureKind, 'stalled');
  assert.equal(context.stage, 'awaiting-response');
  assert.equal(context.xhrStage, 'acked');
  assert.equal(context.retry, 'recovered');
  assert.equal(context.attempts, 1);
});

test('when the retry also stalls, the stuck first attempt is reported once as failed', async () => {
  const timers = makeTimers();
  const { apiClient, registerRequestTraceHooks, reports, calls } = loadClient({
    timers,
    fetchImpl: (options) => stalledFetch(options),
  });
  registerRequestTraceHooks(traceHooks());

  const pending = apiClient('/note');
  await tick();
  timers.fireSoonest(); // 第一次卡顿检查
  await tick();
  timers.fireSoonest(); // 重试的 7s 预算

  // 用户看到的是重试的超时。
  await assert.rejects(pending, (error) => error.name === 'ApiError' && error.failureKind === 'timeout');
  assert.equal(calls.length, 2);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].context.failureKind, 'stalled');
  assert.equal(reports[0].context.attempts, 2);
  assert.equal(reports[0].context.retry, 'failed');
});

test('a retry that gets a 5xx counts as a recovered stall plus an ordinary server error', async () => {
  const timers = makeTimers();
  const { apiClient, registerRequestTraceHooks, reports } = loadClient({
    timers,
    fetchImpl: (options, n) =>
      n === 1
        ? stalledFetch(options)
        : Promise.resolve({
            ok: false,
            status: 503,
            headers: { get: () => null },
            text: async () => JSON.stringify({ code: 503, message: 'busy', data: null }),
          }),
  });
  registerRequestTraceHooks(traceHooks());

  const pending = apiClient('/note');
  await tick();
  timers.fireSoonest();
  await assert.rejects(pending, (error) => error.status === 503);

  assert.deepEqual(
    reports.map(({ context }) => [context.status, context.failureKind, context.retry]),
    [
      [0, 'stalled', 'recovered'],
      [503, 'http', undefined],
    ],
  );
});

test('a stall is not retried or reported once the session changed', async () => {
  const timers = makeTimers();
  const session = { epoch: 1 };
  const { apiClient, registerRequestTraceHooks, reports, calls } = loadClient({
    timers,
    session,
    fetchImpl: (options) => {
      session.epoch = 2; // 等待期间退出登录 / 切了账号
      return stalledFetch(options);
    },
  });
  registerRequestTraceHooks(traceHooks());

  const pending = apiClient('/note');
  await tick();
  timers.fireSoonest();

  await assert.rejects(pending);
  assert.equal(calls.length, 1);
  assert.equal(reports.length, 0);
});

test('a non-GET request is never cut early or retried', async () => {
  const timers = makeTimers();
  const { apiClient, registerRequestTraceHooks, calls } = loadClient({
    timers,
    fetchImpl: (options) => stalledFetch(options),
  });
  registerRequestTraceHooks(traceHooks());

  const pending = apiClient('/note/source-states', { method: 'POST', body: { ids: ['a'] } });
  await tick();
  timers.fireSoonest();

  await assert.rejects(pending, (error) => error.failureKind === 'timeout');
  assert.equal(calls.length, 1);
  assert.deepEqual(timers.delays, [15000]);
});

// iOS 上的实况：XHR 已完成，whatwg-fetch 随即摘掉中止监听，之后 res.text() 挂住就再也
// 没人能叫停——页面永远转圈，Sentry 一条超时都收不到。
test('a body read that ignores the abort signal still fails when the budget runs out', async () => {
  const timers = makeTimers();
  const { apiClient, reports } = loadClient({
    timers,
    fetchImpl: () =>
      Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: neverSettles }),
  });

  const pending = apiClient('/note/drafts/1', { method: 'PUT', body: {} });
  await tick();
  timers.fireSoonest();

  await settlesWithin(assert.rejects(pending, (error) => error.failureKind === 'timeout'));
  assert.equal(reports[0].context.stage, 'reading-body');
});

test('a GET whose body read hangs after the XHR finished is cut and retried', async () => {
  const timers = makeTimers();
  const { apiClient, registerRequestTraceHooks, calls } = loadClient({
    timers,
    fetchImpl: (_options, n) =>
      Promise.resolve(
        n === 1
          ? { ok: true, status: 200, headers: { get: () => null }, text: neverSettles }
          : okResponse({ id: 11 }),
      ),
  });
  // XHR 已完成（不再「在收数据」），body 却交不到 JS：算卡住。
  registerRequestTraceHooks(traceHooks({ isReceiving: () => false }));

  const pending = apiClient('/note');
  await tick();
  timers.fireSoonest();

  assert.equal((await settlesWithin(pending)).id, 11);
  assert.equal(calls.length, 2);
});

test('trace hooks see the sent request id and their diagnostics ride on the failure report', async () => {
  const timers = makeTimers();
  const begun = [];
  const finished = [];
  const { apiClient, registerRequestTraceHooks, reports, calls } = loadClient({
    timers,
    fetchImpl: (options) => stalledFetch(options),
  });
  registerRequestTraceHooks(traceHooks({
    begin: (requestId) => begun.push(requestId),
    finish: (requestId, failed) => {
      finished.push({ requestId, failed });
      return { xhrStage: 'acked', xhrAckMs: 40, inflight: 3 };
    },
  }));

  const pending = apiClient('/note/source-states', { method: 'POST', body: {} });
  await tick();
  timers.fireSoonest();
  await assert.rejects(pending);

  assert.equal(begun[0], calls[0].options.headers['X-Request-Id']);
  assert.deepEqual(finished, [{ requestId: begun[0], failed: true }]);
  const { context } = reports[0];
  assert.equal(context.stage, 'awaiting-response');
  assert.equal(context.xhrStage, 'acked');
  assert.equal(context.xhrAckMs, 40);
  assert.equal(context.inflight, 3);
});

test('a body that cannot be serialized never leaves a trace open', async () => {
  const timers = makeTimers();
  const begun = [];
  const { apiClient, registerRequestTraceHooks } = loadClient({
    timers,
    fetchImpl: () => Promise.resolve(okResponse({})),
  });
  registerRequestTraceHooks(traceHooks({ begin: (requestId) => begun.push(requestId) }));
  const circular = {};
  circular.self = circular;

  await assert.rejects(apiClient('/note', { method: 'POST', body: circular }));
  assert.deepEqual(begun, []);
  assert.equal(timers.armed(), 0);
});

test('a throwing trace hook never changes the request outcome', async () => {
  const timers = makeTimers();
  const { apiClient, registerRequestTraceHooks } = loadClient({
    timers,
    fetchImpl: () => Promise.resolve(okResponse({ id: 9 })),
  });
  const boom = () => {
    throw new Error('hook bug');
  };
  registerRequestTraceHooks({ begin: boom, finish: boom, isReceiving: boom });

  assert.equal((await apiClient('/note')).id, 9);
});

// 安卓 OkHttp 心跳判死连接时，挂在上面的请求直接以网络错误失败；连接已被移出池子，
// GET 换新请求会走新连接。
test('a GET that fails with a network error is retried once with the rest of the budget', async () => {
  const timers = makeTimers();
  const { apiClient, registerRequestTraceHooks, reports, calls } = loadClient({
    timers,
    fetchImpl: (_options, n) =>
      n === 1 ? Promise.reject(new TypeError('Network request failed')) : Promise.resolve(okResponse({ id: 12 })),
  });
  registerRequestTraceHooks(traceHooks());

  assert.equal((await apiClient('/note')).id, 12);
  assert.equal(calls.length, 2);
  assert.ok(timers.delays[2] > 14_000, `retry budget ${timers.delays[2]}`);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].context.failureKind, 'network');
  assert.equal(reports[0].context.retry, 'recovered');
});

test('a non-GET request that fails with a network error is not retried', async () => {
  const timers = makeTimers();
  const { apiClient, calls } = loadClient({
    timers,
    fetchImpl: () => Promise.reject(new TypeError('Network request failed')),
  });

  await assert.rejects(
    apiClient('/note/source-states', { method: 'POST', body: {} }),
    (error) => error.failureKind === 'network',
  );
  assert.equal(calls.length, 1);
});
