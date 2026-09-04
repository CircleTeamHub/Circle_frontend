const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// reportHandledFailure 是业务 catch 站点的统一出口。这里钉住四条不变量：
//   1. 预期内的失败（ApiError 等已由别处决定过是否上报的类型）绝不进 Sentry，
//      但仍留面包屑；
//   2. 真正的失败按 operation:kind 去重，且每个 key 有签名上限；
//   3. 进 Sentry 的 context 一定带 operation + kind（fingerprint 依赖它们），
//      调用方传进来的同名字段不能把它们覆盖掉；
//   4. 观测层自身抛错不能改变业务行为。

function loadReportFailure({ dev = false, breakDiagnostics = false } = {}) {
  const reports = [];
  const diagnostics = [];
  const warnCalls = [];
  const mod = loadTsModule('src/observability/report-failure.ts', {
    requireShim: (request) => {
      switch (request) {
        case './sentry':
          return {
            reportError: (error, context) => reports.push({ error, context }),
          };
        case '@/utils/client-diagnostics':
          return {
            diagnosticErrorMessage: (error) =>
              error instanceof Error ? error.message : String(error),
            logClientDiagnostic: (event, details) => {
              if (breakDiagnostics) throw new Error('diagnostics exploded');
              diagnostics.push([event, details]);
            },
          };
        case '@/utils/redact':
          return loadTsModule('src/utils/redact.ts');
        default:
          return require(request);
      }
    },
    context: {
      __DEV__: dev,
      console: { warn: (...args) => warnCalls.push(args) },
    },
  });
  return { ...mod, reports, diagnostics, warnCalls };
}

// VM 里产生的对象带着另一个 realm 的 Object.prototype，deepEqual 会因原型不同
// 而失败；比较前先转成本 realm 的 plain object。
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function apiError(status) {
  const error = new Error('request failed');
  error.name = 'ApiError';
  error.status = status;
  return error;
}

test('reports a genuine failure once with operation + kind and a breadcrumb', () => {
  const { reportHandledFailure, reports, diagnostics } = loadReportFailure();

  reportHandledFailure('storage', 'primaryStoreOpen', new Error('disk full'), {
    reason: 'rebuild',
  });

  assert.equal(reports.length, 1);
  assert.equal(reports[0].error.message, 'disk full');
  assert.deepEqual(plain(reports[0].context), {
    reason: 'rebuild',
    operation: 'storage',
    kind: 'primaryStoreOpen',
  });
  assert.deepEqual(plain(diagnostics), [
    [
      'storage.primaryStoreOpen.failed',
      { reason: 'rebuild', errorName: 'Error' },
    ],
  ]);
});

test('expected failures (ApiError & friends) leave a breadcrumb but never reach Sentry', () => {
  const { reportHandledFailure, reports, diagnostics, isExpectedFailure } =
    loadReportFailure();

  const chatSendError = new Error('CHAT_RATE_LIMITED');
  chatSendError.name = 'ChatSendError';
  const abort = new Error('aborted');
  abort.name = 'AbortError';
  const userFacing = new Error('资料已提交');
  userFacing.name = 'UserFacingError';

  for (const error of [apiError(500), apiError(404), chatSendError, abort, userFacing]) {
    assert.equal(isExpectedFailure(error), true);
    reportHandledFailure('messages', 'refresh', error);
  }

  assert.equal(reports.length, 0);
  assert.equal(diagnostics.length, 5);
  assert.equal(isExpectedFailure(new Error('boom')), false);
  assert.equal(isExpectedFailure('string'), false);
});

test('deduplicates by operation:kind signature with a per-key cap', () => {
  const { reportHandledFailure, reports } = loadReportFailure();

  reportHandledFailure('chatSync', 'readAck', new Error('timeout'));
  reportHandledFailure('chatSync', 'readAck', new Error('timeout'));
  reportHandledFailure('chatSync', 'readAck', new Error('rejected'));
  reportHandledFailure('chatSync', 'readAck', new Error('closed'));
  // 第 4 个不同签名超出上限，静默丢弃
  reportHandledFailure('chatSync', 'readAck', new Error('fourth'));
  // 别的 kind 有自己独立的预算
  reportHandledFailure('chatSync', 'localHydrate', new Error('timeout'));

  assert.deepEqual(
    reports.map((r) => `${r.context.kind}:${r.error.message}`),
    [
      'readAck:timeout',
      'readAck:rejected',
      'readAck:closed',
      'localHydrate:timeout',
    ],
  );
});

test('resetHandledFailureTelemetry clears the dedupe ledger', () => {
  const { reportHandledFailure, resetHandledFailureTelemetry, reports } =
    loadReportFailure();

  reportHandledFailure('call', 'accept', new Error('x'));
  reportHandledFailure('call', 'accept', new Error('x'));
  resetHandledFailureTelemetry();
  reportHandledFailure('call', 'accept', new Error('x'));

  assert.equal(reports.length, 2);
});

test('caller context cannot override operation/kind and unstable tags fall back', () => {
  const { reportHandledFailure, reports } = loadReportFailure();

  reportHandledFailure('user content here!', 'kind with spaces', new Error('x'), {
    operation: 'spoofed',
    kind: 'spoofed',
    nested: { not: 'primitive' },
    count: 3,
  });

  assert.equal(reports.length, 1);
  assert.deepEqual(plain(reports[0].context), {
    count: 3,
    operation: 'unknownOperation',
    kind: 'unknownKind',
  });
});

test('dev console output is redacted and silent in production', () => {
  const dev = loadReportFailure({ dev: true });
  dev.reportHandledFailure(
    'auth',
    'serverLogout',
    new Error('private response data'),
    {
      token: 'secret-token',
    },
  );
  assert.equal(dev.warnCalls.length, 1);
  assert.equal(dev.warnCalls[0][0], '[auth] serverLogout failed');
  assert.equal(dev.warnCalls[0][1].token, '[REDACTED]');
  assert.equal(dev.warnCalls[0][1].errorName, 'Error');
  assert.equal(dev.warnCalls[0].length, 2);
  assert.doesNotMatch(JSON.stringify(dev.warnCalls), /private response data/);

  const prod = loadReportFailure({ dev: false });
  prod.reportHandledFailure('auth', 'serverLogout', new Error('boom'));
  assert.equal(prod.warnCalls.length, 0);
});

test('never throws even when the diagnostics layer explodes', () => {
  const { reportHandledFailure } = loadReportFailure({ breakDiagnostics: true });

  assert.doesNotThrow(() =>
    reportHandledFailure('storage', 'anything', new Error('x')),
  );
});
