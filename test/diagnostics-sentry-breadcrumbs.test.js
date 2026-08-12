const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

// 诊断面包屑接 Sentry 的隐私边界测试。
//
// 背景：logClientDiagnostic 今天在 production 直接短路，什么都不发——它是纯 dev
// 的 console.warn。把它接到 Sentry 是数据第一次离开用户设备、去到第三方的那一刻，
// 所以这里的门槛是隐私，不是功能。这个文件锁住三条不变量：
//   1. 只有白名单里的 key 能到 Sentry（黑名单永远漏，比如 message 装的是任意错误文本）
//   2. 没有错误上报时，一个字节都不发（不新开上传通道）
//   3. dev console 的行为一个字都不变

/**
 * 把 client-diagnostics 与 sentry 装进同一组 stub 里：两个模块必须共享同一份
 * 诊断缓冲区实例，否则测的就不是真实接线。
 *
 * Sentry SDK 用 Proxy 记录「任何」被调用到的方法——这样「没有错误上报时不发任何
 * 东西」就不是只断言 captureException 没被调，而是断言整个 SDK 表面都没被碰过。
 */
function loadDiagnosticsWithSentry({ dev = false } = {}) {
  const warnCalls = [];
  const sdkCalls = [];

  const diagnostics = loadTsModule('src/utils/client-diagnostics.ts', {
    requireShim: (request) => {
      if (request === '@/utils/redact') return loadTsModule('src/utils/redact.ts');
      return require(request);
    },
    context: {
      __DEV__: dev,
      console: { warn: (...args) => warnCalls.push(args) },
    },
  });

  const sentrySdk = new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === 'wrap') return (component) => component;
        return (...args) => {
          sdkCalls.push({ method: String(prop), args });
        };
      },
    },
  );

  const sentry = loadTsModule('src/observability/sentry.ts', {
    requireShim: (request) => {
      if (request === './route-segments')
        return loadTsModule('src/observability/route-segments.ts', {});
      if (request === '@/utils/client-diagnostics') return diagnostics;
      if (request === '@sentry/react-native') return sentrySdk;
      if (request === 'expo-constants') return { expoConfig: { extra: {} } };
      return require(request);
    },
    context: { __DEV__: dev, console, process: { env: {} } },
  });

  return { diagnostics, sentry, warnCalls, sdkCalls };
}

function captureWith(sentry) {
  const calls = [];
  const client = { captureException: (error, ctx) => calls.push({ error, ctx }) };
  return { calls, client };
}

function breadcrumbsFrom(call) {
  return call.ctx?.extra?.clientDiagnostics;
}

// ---------------------------------------------------------------------------
// 1. 白名单：只有已知安全的 key 能到第三方
// ---------------------------------------------------------------------------

test('non-allowlisted keys never reach Sentry (message carries arbitrary text)', () => {
  const { diagnostics, sentry } = loadDiagnosticsWithSentry();
  const { calls, client } = captureWith(sentry);

  // message 装的是 error.message —— 任意文本，可能带用户昵称、圈子名、后端原始报错。
  // 按 key 名过滤的黑名单永远抓不到它，这正是白名单存在的理由。
  diagnostics.logClientDiagnostic('circle_invite_submit_failed', {
    circleId: 'circle-1',
    message: 'user 张三 (zhangsan@example.com) is not a member of 私密圈子',
  });

  sentry.reportError(new Error('boom'), { operation: 'test' }, client);

  const serialized = JSON.stringify(calls);
  assert.doesNotMatch(serialized, /张三/);
  assert.doesNotMatch(serialized, /zhangsan@example\.com/);
  assert.doesNotMatch(serialized, /私密圈子/);

  const crumbs = breadcrumbsFrom(calls[0]);
  assert.equal(crumbs.length, 1);
  assert.equal(crumbs[0].event, 'circle_invite_submit_failed');
  assert.equal('message' in crumbs[0].details, false);
});

test('allowlisted keys do reach Sentry as breadcrumbs on a reported error', () => {
  const { diagnostics, sentry } = loadDiagnosticsWithSentry();
  const { calls, client } = captureWith(sentry);

  diagnostics.logClientDiagnostic('circle_invite_partial_failed', {
    circleId: 'circle-1',
    succeeded: 3,
    failed: 2,
  });

  sentry.reportError(new Error('boom'), undefined, client);

  const crumbs = breadcrumbsFrom(calls[0]);
  assert.equal(crumbs.length, 1);
  assert.equal(crumbs[0].details.circleId, 'circle-1');
  assert.equal(crumbs[0].details.succeeded, 3);
  assert.equal(crumbs[0].details.failed, 2);
});

test('an unknown key added by a future call site is dropped by default', () => {
  const { diagnostics, sentry } = loadDiagnosticsWithSentry();
  const { calls, client } = captureWith(sentry);

  // 白名单的价值在于「默认拒绝」：新增字段必须有人显式加进清单，
  // 不能因为没人想起来更新黑名单就自动流向第三方。
  diagnostics.logClientDiagnostic('some_future_event', {
    circleId: 'circle-1',
    searchQuery: 'my private search text',
    nickname: '张三',
  });

  sentry.reportError(new Error('boom'), undefined, client);

  const serialized = JSON.stringify(calls);
  assert.doesNotMatch(serialized, /my private search text/);
  assert.doesNotMatch(serialized, /张三/);
  assert.deepEqual(Object.keys(breadcrumbsFrom(calls[0])[0].details), ['circleId']);
});

test('an event with no allowlisted details still records the event name only', () => {
  const { diagnostics, sentry } = loadDiagnosticsWithSentry();
  const { calls, client } = captureWith(sentry);

  diagnostics.logClientDiagnostic('share_circle_conversations_load_failed', {
    message: 'Network request failed for 用户私密数据',
  });

  sentry.reportError(new Error('boom'), undefined, client);

  const crumbs = breadcrumbsFrom(calls[0]);
  assert.equal(crumbs.length, 1);
  assert.equal(crumbs[0].event, 'share_circle_conversations_load_failed');
  // Object.keys 而非 deepEqual：details 在 vm realm 里构造，跨 realm 的原型不同，
  // deepStrictEqual 会因原型不等而失败（见 sentry-observability.test.js 同款注释）。
  assert.deepEqual(Object.keys(crumbs[0].details), []);
  assert.doesNotMatch(JSON.stringify(calls), /用户私密数据/);
});

// ---------------------------------------------------------------------------
// 2. 承重测试：没有错误上报时，什么都不发
// ---------------------------------------------------------------------------

test('LOAD-BEARING: logging diagnostics alone touches no Sentry SDK method', () => {
  const { diagnostics, sdkCalls } = loadDiagnosticsWithSentry();

  for (let i = 0; i < 25; i++) {
    diagnostics.logClientDiagnostic('notification_open', {
      source: 'system_push',
      requestIdentifier: `req-${i}`,
    });
  }

  // 不是只断言 captureException 没被调 —— 整个 SDK 表面都没被碰过。
  // 只要 logClientDiagnostic 哪天偷偷开了新通道（captureMessage / addBreadcrumb /
  // 任何方法），这条就红。
  assert.deepEqual(sdkCalls, []);
});

test('LOAD-BEARING: client-diagnostics cannot send — it has no Sentry dependency', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/utils/client-diagnostics.ts'),
    'utf8',
  );

  // 结构性保证：诊断模块对 Sentry 一无所知，所以它没有能力发送任何东西。
  // 面包屑是被 reportError 拉走的，不是被 logClientDiagnostic 推出去的。
  // 只看代码，不看注释——注释里可以（也应该）解释这套接线。
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  assert.doesNotMatch(code, /@sentry\/react-native/);
  assert.doesNotMatch(code, /observability\/sentry/);
  assert.doesNotMatch(code, /captureMessage|captureException|addBreadcrumb/);
  // 兜底：整个模块不含任何 import/require 除了共享脱敏表。
  const imports = code.match(/^\s*import[\s\S]*?from\s+'([^']+)'/gm) ?? [];
  assert.deepEqual(
    imports.map((line) => /from\s+'([^']+)'/.exec(line)[1]),
    ['@/utils/redact'],
  );
});

test('LOAD-BEARING: breadcrumbs stay on-device until an error is actually reported', () => {
  const { diagnostics, sentry } = loadDiagnosticsWithSentry();
  const { calls, client } = captureWith(sentry);

  diagnostics.logClientDiagnostic('notification_open', { source: 'system_push' });
  assert.equal(calls.length, 0);

  // 只有真的报错时才随那次上报一起走。
  sentry.reportError(new Error('boom'), undefined, client);
  assert.equal(calls.length, 1);
  assert.equal(breadcrumbsFrom(calls[0]).length, 1);
});

test('reportError without Sentry initialized still sends nothing', () => {
  const { diagnostics, sentry, sdkCalls } = loadDiagnosticsWithSentry();

  diagnostics.logClientDiagnostic('notification_open', { source: 'system_push' });
  // 不注入 client → 走默认 Sentry client → 未 init 时必须直接 no-op。
  sentry.reportError(new Error('boom'), { operation: 'test' });

  assert.deepEqual(sdkCalls, []);
});

// ---------------------------------------------------------------------------
// 3. 缓冲区行为
// ---------------------------------------------------------------------------

test('breadcrumb buffer is bounded and keeps the most recent events', () => {
  const { diagnostics, sentry } = loadDiagnosticsWithSentry();
  const { calls, client } = captureWith(sentry);

  for (let i = 0; i < 40; i++) {
    diagnostics.logClientDiagnostic('notification_open', {
      source: 'system_push',
      page: i,
    });
  }

  sentry.reportError(new Error('boom'), undefined, client);

  const crumbs = breadcrumbsFrom(calls[0]);
  assert.ok(crumbs.length <= 20, `buffer should be bounded, got ${crumbs.length}`);
  // 最近的事件留下，最老的被挤掉。
  assert.equal(crumbs[crumbs.length - 1].details.page, 39);
});

test('resetDiagnosticBreadcrumbs drops buffered events so they cannot cross sessions', () => {
  const { diagnostics, sentry } = loadDiagnosticsWithSentry();
  const { calls, client } = captureWith(sentry);

  // 账号 A 的活动
  diagnostics.logClientDiagnostic('circle_invite_all_failed', {
    circleId: 'account-a-private-circle',
  });

  // 登出 teardown（services/auth/session.ts 在 clearSession 后调用）
  diagnostics.resetDiagnosticBreadcrumbs();

  // 账号 B 触发一次错误上报——不能带上 A 的圈子 ID。
  sentry.reportError(new Error('boom'), { operation: 'test' }, client);

  assert.doesNotMatch(JSON.stringify(calls), /account-a-private-circle/);
  assert.equal(breadcrumbsFrom(calls[0]), undefined);
});

test('session teardown actually calls resetDiagnosticBreadcrumbs', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/services/auth/session.ts'),
    'utf8',
  );

  // 缓冲区是进程级的、切号不重启 —— 少了这一行就是跨账号泄漏。
  assert.match(source, /resetDiagnosticBreadcrumbs\(\)/);
  assert.match(source, /from '@\/utils\/client-diagnostics'/);
});

// 面包屑读失败时，绝不能把错误上报本身一起弄丢。reportError 的 try/catch 是静默的，
// 所以一旦 readDiagnosticBreadcrumbs 抛异常，captureException 会被一起吞掉——
// 那是「为了加面包屑，反而丢了错误上报」，比没有面包屑严重得多。
test('a throwing breadcrumb reader still lets the error itself be reported', () => {
  const sentry = loadTsModule('src/observability/sentry.ts', {
    requireShim: (request) => {
      if (request === './route-segments')
        return loadTsModule('src/observability/route-segments.ts', {});
      if (request === '@/utils/client-diagnostics') {
        return {
          readDiagnosticBreadcrumbs: () => {
            throw new Error('diagnostics module exploded');
          },
        };
      }
      if (request === '@sentry/react-native') {
        return { init() {}, wrap: (c) => c, captureException() {} };
      }
      if (request === 'expo-constants') return { expoConfig: { extra: {} } };
      return require(request);
    },
    context: { __DEV__: false, console, process: { env: {} } },
  });

  const { calls, client } = captureWith(sentry);
  sentry.reportError(new Error('boom'), { operation: 'test' }, client);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].error.message, 'test error failure');
  assert.doesNotMatch(calls[0].error.message, /boom/);
  assert.equal(calls[0].ctx.extra.operation, 'test');
  assert.equal(breadcrumbsFrom(calls[0]), undefined);
});

test('reportError with no diagnostics attaches no breadcrumb key at all', () => {
  const { sentry } = loadDiagnosticsWithSentry();
  const { calls, client } = captureWith(sentry);

  sentry.reportError(new Error('boom'), { operation: 'test' }, client);

  assert.equal(calls.length, 1);
  assert.equal(breadcrumbsFrom(calls[0]), undefined);
});

test('existing reportError context and tags survive breadcrumb attachment', () => {
  const { diagnostics, sentry } = loadDiagnosticsWithSentry();
  const { calls, client } = captureWith(sentry);

  diagnostics.logClientDiagnostic('notification_open', { source: 'system_push' });

  sentry.reportError(
    new Error('Database error'),
    {
      endpointPath: '/note/:id/exports',
      method: 'POST',
      status: 500,
      apiCode: 10001,
      failureKind: 'api-code',
    },
    client,
  );

  assert.equal(calls[0].ctx.tags.endpointPath, '/note/:id/exports');
  assert.equal(calls[0].ctx.tags.method, 'POST');
  assert.equal(calls[0].ctx.extra.status, 500);
  assert.equal(calls[0].ctx.fingerprint[0], 'api');
  assert.equal(breadcrumbsFrom(calls[0]).length, 1);
});

// ---------------------------------------------------------------------------
// 4. dev console 行为不回归
// ---------------------------------------------------------------------------

test('dev console still receives the full un-allowlisted details', () => {
  const { diagnostics, warnCalls } = loadDiagnosticsWithSentry({ dev: true });

  diagnostics.logClientDiagnostic('circle_invite_submit_failed', {
    circleId: 'circle-1',
    message: 'boom happened',
  });

  // 白名单是「上传给第三方」的闸门，不是本地调试的闸门。本地 console 一个字都不能少，
  // 否则等于用隐私之名把 dev 的排障能力也砍了。
  assert.equal(warnCalls.length, 1);
  assert.equal(warnCalls[0][0], '[client-diagnostic] circle_invite_submit_failed');
  assert.equal(warnCalls[0][1].circleId, 'circle-1');
  assert.equal(warnCalls[0][1].message, 'boom happened');
});

test('dev console still redacts sensitive fields via the shared redact list', () => {
  const { diagnostics, warnCalls } = loadDiagnosticsWithSentry({ dev: true });

  diagnostics.logClientDiagnostic('push_token_register_failed', {
    circleId: 'circle-1',
    token: 'super-secret-push-token',
    accessToken: 'super-secret-access-token',
  });

  const serialized = JSON.stringify(warnCalls);
  assert.doesNotMatch(serialized, /super-secret-push-token/);
  assert.doesNotMatch(serialized, /super-secret-access-token/);
  assert.match(serialized, /\[REDACTED\]/);
  assert.match(serialized, /circle-1/);
});

test('production still logs nothing to console even if console survives', () => {
  const { diagnostics, warnCalls } = loadDiagnosticsWithSentry({ dev: false });

  diagnostics.logClientDiagnostic('push_token_register_failed', {
    token: 'super-secret-push-token',
  });

  assert.equal(warnCalls.length, 0);
});

// 双层防护的第二层：即便某个 key 混进了白名单，共享脱敏表仍然要拦一次。
test('redactSensitiveFields still applies to breadcrumbs as a second layer', () => {
  const { diagnostics, sentry } = loadDiagnosticsWithSentry();
  const { calls, client } = captureWith(sentry);

  diagnostics.logClientDiagnostic('share_circle_send_failed', {
    circleId: 'circle-1',
    // 白名单里的 key，但值是预签名 URL —— redact.ts 的值级规则必须仍然生效。
    conversationID:
      'https://oss.example.com/x?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=deadbeef',
  });

  sentry.reportError(new Error('boom'), undefined, client);

  // 先钉住面包屑确实到了 —— 否则这条断言会因为「压根没面包屑」而假绿。
  const crumbs = breadcrumbsFrom(calls[0]);
  assert.equal(crumbs.length, 1);
  assert.equal(crumbs[0].details.circleId, 'circle-1');

  const serialized = JSON.stringify(calls);
  assert.doesNotMatch(serialized, /X-Amz-Signature/);
  assert.doesNotMatch(serialized, /deadbeef/);
});
