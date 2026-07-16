const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

function loadClientDiagnostics({ dev }) {
  const warnCalls = [];
  const { logClientDiagnostic } = loadTsModule('src/utils/client-diagnostics.ts', {
    requireShim: (request) => {
      if (request === '@/utils/redact') {
        return loadTsModule('src/utils/redact.ts');
      }
      return require(request);
    },
    context: {
      __DEV__: dev,
      console: { warn: (...args) => warnCalls.push(args) },
    },
  });

  return { logClientDiagnostic, warnCalls };
}

test('client diagnostics redact sensitive fields before logging in dev', () => {
  const { logClientDiagnostic, warnCalls } = loadClientDiagnostics({ dev: true });

  logClientDiagnostic('push_token_register_failed', {
    circleId: 'circle-1',
    token: 'super-secret-push-token',
    accessToken: 'super-secret-access-token',
    attempt: 2,
  });

  assert.equal(warnCalls.length, 1);
  const serialized = JSON.stringify(warnCalls);
  assert.doesNotMatch(serialized, /super-secret-push-token/);
  assert.doesNotMatch(serialized, /super-secret-access-token/);
  assert.match(serialized, /\[REDACTED\]/);
  // 非敏感字段必须原样保留，否则脱敏就把诊断价值一起脱没了。
  assert.match(serialized, /circle-1/);
  assert.match(serialized, /push_token_register_failed/);
});

test('client diagnostics drop undefined details but keep null and false', () => {
  const { logClientDiagnostic, warnCalls } = loadClientDiagnostics({ dev: true });

  logClientDiagnostic('notification_mark_read_failed', {
    missing: undefined,
    explicitlyNull: null,
    flag: false,
  });

  const [, details] = warnCalls[0];
  assert.deepEqual(Object.keys(details), ['explicitlyNull', 'flag']);
  assert.equal(details.explicitlyNull, null);
  assert.equal(details.flag, false);
});

// production 里 console.warn 本来就会被 babel 的 transform-remove-console 剥掉，
// 但那是构建配置。这条断言锁的是运行时行为：即使 strip 没生效，__DEV__ 短路也不让
// 任何东西出去。两层防护里的第二层，正是「配置漏了」时唯一还站着的那层。
test('client diagnostics stay silent outside dev even if console survives', () => {
  const { logClientDiagnostic, warnCalls } = loadClientDiagnostics({ dev: false });

  logClientDiagnostic('push_token_register_failed', {
    token: 'super-secret-push-token',
  });

  assert.equal(warnCalls.length, 0);
});
