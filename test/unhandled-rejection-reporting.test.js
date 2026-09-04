const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// silenceDomBridgeRejection 顶掉了 Sentry 自带的 rejection tracker 钩子,所以它
// 是整个 app 未处理 rejection 进 Sentry 的唯一出口。这里钉住三条不变量:
//   1. DOM 桥接的那类良性 rejection 仍然被静默;
//   2. 其余 rejection 会转发给 Sentry,但同一签名只报一次、总量封顶 ——
//      和 reportHandledFailure / RouteErrorBoundary 一样,别让一个反复 reject 的
//      库把配额刷空;
//   3. 每一条(哪怕被去重)仍留 dev 警告,本地排查不受影响。

function loadTracker() {
  const reports = [];
  const warnings = [];
  let handlers = null;
  const mod = loadTsModule('src/utils/silence-dom-bridge-rejection.ts', {
    requireShim: (request) => {
      switch (request) {
        case 'promise/setimmediate/rejection-tracking':
          return {
            default: {
              enable: (options) => {
                handlers = options;
              },
            },
          };
        case '@/observability/sentry':
          return {
            reportError: (error, context) => reports.push({ error, context }),
          };
        case '@/utils/dev-log':
          return { devWarn: (message) => warnings.push(message) };
        default:
          throw new Error(`unexpected import: ${request}`);
      }
    },
  });
  mod.silenceDomBridgeRejection();
  assert.ok(handlers, 'enable() must be called with the tracker handlers');
  assert.equal(handlers.allRejections, true);
  return { ...mod, handlers, reports, warnings };
}

test('the DOM bridge teardown rejection stays silent', () => {
  const { handlers, reports, warnings } = loadTracker();
  handlers.onUnhandled(
    1,
    new Error('DomWebView: injectJavaScript on a destroyed view'),
  );
  assert.equal(reports.length, 0);
  assert.equal(warnings.length, 0);
});

test('other rejections reach Sentry once per signature, with dev output every time', () => {
  const { handlers, reports, warnings } = loadTracker();
  handlers.onUnhandled(1, new TypeError('x is not a function'));
  handlers.onUnhandled(2, new TypeError('x is not a function'));
  handlers.onUnhandled(3, new TypeError('x is not a function'));

  assert.equal(reports.length, 1, '同一签名只上报一次');
  assert.equal(reports[0].context.operation, 'unhandledRejection');
  assert.equal(reports[0].context.kind, 'promise');
  assert.equal(warnings.length, 3, 'dev 警告不去重');

  handlers.onUnhandled(4, new RangeError('different failure'));
  assert.equal(reports.length, 2, '不同签名各报一次');

  // 非 Error 的 reject 值同样有签名,不会因为没有 name 而绕过去重。
  handlers.onUnhandled(5, 'plain string rejection');
  handlers.onUnhandled(6, 'plain string rejection');
  assert.equal(reports.length, 3);
});

test('the number of distinct signatures reported per process is bounded', () => {
  const { handlers, reports, resetUnhandledRejectionTelemetry } = loadTracker();
  for (let i = 0; i < 100; i += 1) {
    handlers.onUnhandled(i, new Error(`flood ${i}`));
  }
  assert.ok(
    reports.length < 100 && reports.length >= 10,
    `expected a bounded number of reports, got ${reports.length}`,
  );
  const cap = reports.length;
  handlers.onUnhandled(999, new Error('one more'));
  assert.equal(reports.length, cap, '达到上限后不再上报新签名');

  resetUnhandledRejectionTelemetry();
  handlers.onUnhandled(1000, new Error('after reset'));
  assert.equal(reports.length, cap + 1);
});
