const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// 与 services/api/client.ts 的 ApiError 同形：report-failure 用 instanceof 判定
// 「这个失败是不是 API 层已经上报过的」，所以桩必须是同一个构造器。
class ApiError extends Error {
  constructor(status) {
    super('request failed');
    this.name = 'ApiError';
    this.status = status;
  }
}

function loadReportFailure({ dev = false } = {}) {
  const reports = [];
  const diagnostics = [];
  const warnCalls = [];

  const module = loadTsModule(
    'src/features/notifications/utils/report-failure.ts',
    {
      requireShim: (request) => {
        switch (request) {
          case '@/utils/client-diagnostics':
            return {
              logClientDiagnostic: (event, details) =>
                diagnostics.push([event, details]),
            };
          case '@/observability/sentry':
            return {
              reportError: (error, context) => reports.push({ error, context }),
            };
          case '@/services/api/client':
            return { ApiError };
          default:
            return require(request);
        }
      },
      context: {
        __DEV__: dev,
        console: { warn: (...args) => warnCalls.push(args) },
      },
    },
  );

  return { ...module, reports, diagnostics, warnCalls };
}

test('reports a native push failure that never reached the API layer', () => {
  const { reportNotificationFailure, reports } = loadReportFailure();

  // getExpoPushTokenAsync / 权限调用 / generateRevocationSecret 的抛错都不经过
  // apiClient，是今天生产里唯一真正无声的一类——推送全挂也没人知道。
  reportNotificationFailure(
    'push_token_register_failed',
    new Error('Default FirebaseApp is not initialized'),
    { platform: 'android' },
  );

  assert.equal(reports.length, 1);
  assert.match(reports[0].error.message, /FirebaseApp/);
  assert.equal(reports[0].context.platform, 'android');
});

test('tags reported failures so Sentry groups them per event, not per message', () => {
  const { reportNotificationFailure, reports } = loadReportFailure();

  reportNotificationFailure('push_token_register_failed', new Error('boom'), {});

  // sentry.ts 的 buildCaptureContext 在没有 endpointPath 时按 operation + kind 组
  // fingerprint。少了这两个 tag 就会退回按 message 分组，同一故障碎成一堆 issue。
  assert.equal(reports[0].context.operation, 'notifications');
  assert.equal(reports[0].context.kind, 'push_token_register_failed');
});

test('does not double-report API failures the api client already reported', () => {
  const { reportNotificationFailure, reports } = loadReportFailure();

  // 通知链路的每个 API 调用都走 apiClient，network(0)/5xx 已在那里上报过一次。
  // 这里再报一次只会是同一根因的第二个 issue（fingerprint 不同）+ 双倍配额。
  reportNotificationFailure('notification_mark_read_failed', new ApiError(500), {
    notificationId: 'n1',
  });
  reportNotificationFailure('push_token_revoke_failed', new ApiError(0), {});

  assert.equal(reports.length, 0);
});

test('does not report expected 4xx API failures', () => {
  const { reportNotificationFailure, reports } = loadReportFailure();

  // 401(会话过期竞态) / 404(通知已删) 在移动端是常态噪音。API 层有意不报,
  // 这里也不越权补报——代价是 register 的 400 契约破损同样不可见,但那属于
  // dev/QA 期就该拦下的系统性 bug,不值得用每会话的 401 噪音去换。
  reportNotificationFailure('notification_delete_failed', new ApiError(404), {});
  reportNotificationFailure('push_token_register_failed', new ApiError(401), {});

  assert.equal(reports.length, 0);
});

test('collapses the same root cause repeating within a session', () => {
  const { reportNotificationFailure, reports, resetNotificationFailureTelemetry } =
    loadReportFailure();

  // 注册器每次 app 切前台都会重跑 sync;撤销队列失败后每 60s 重试一次,永不停。
  // 不去重的话,一个 FCM 配置错误就能按「用户数 × 前台次数」刷爆 Sentry 配额。
  for (let index = 0; index < 5; index += 1) {
    reportNotificationFailure('push_token_register_failed', new Error('same cause'), {});
  }
  assert.equal(reports.length, 1);

  resetNotificationFailureTelemetry();
  reportNotificationFailure('push_token_register_failed', new Error('same cause'), {});
  assert.equal(reports.length, 2);
});

test('lets distinct root causes behind one event name through', () => {
  const { reportNotificationFailure, reports } = loadReportFailure();

  // push_token_register_failed 是整个 sync() 的兜底 catch:权限、
  // getExpoPushTokenAsync、generateRevocationSecret 的 hard throw 全挤在这一个名字
  // 下。只按事件名去重的话,开机时一次弱网超时就把预算烧了,同会话里稍后那条
  // 「推送 100% 死」永远发不出去——正好把最该看见的那条藏了。
  reportNotificationFailure(
    'push_token_register_failed',
    new Error('APNs request timed out'),
    {},
  );
  reportNotificationFailure(
    'push_token_register_failed',
    new Error('Secure random source unavailable for push revocation'),
    {},
  );

  assert.equal(reports.length, 2);
  assert.match(reports[1].error.message, /Secure random source/);
});

test('caps signatures per event when the message varies every time', () => {
  const { reportNotificationFailure, reports } = loadReportFailure();

  // signature 带上 message 就有基数风险:原生错误偶尔会把可变细节拼进 message。
  // 上限是兜底,保证「按内容去重」不会退化成不去重。
  for (let index = 0; index < 50; index += 1) {
    reportNotificationFailure(
      'push_token_register_failed',
      new Error(`native failure at t=${index}`),
      {},
    );
  }

  assert.ok(reports.length > 0);
  assert.ok(
    reports.length <= 3,
    `expected a per-event ceiling, got ${reports.length}`,
  );
});

test('a noisy event cannot starve a different event of its budget', () => {
  const { reportNotificationFailure, reports } = loadReportFailure();

  // notification_navigate_failed 的 message 基数最高:route 由服务端下发的 payload
  // 推导,router 报错常把 href 拼进 message,于是每条都是新 signature。预算若是全局
  // 的,它刷满之后「推送 100% 死」那条就再也发不出去——而上限存在的理由(基数风险
  // 真实)恰恰就是它能刷满的原因。所以预算必须每事件独立:吵的事件永远不许饿死安静的。
  for (let index = 0; index < 30; index += 1) {
    reportNotificationFailure(
      'notification_navigate_failed',
      new Error(`no route registered for /discover/thing/${index}`),
      {},
    );
  }
  const beforeCount = reports.length;

  reportNotificationFailure(
    'push_token_register_failed',
    new Error('Secure random source unavailable for push revocation'),
    {},
  );

  assert.equal(
    reports.length,
    beforeCount + 1,
    'a brand-new event must still get through after another event flooded',
  );
  assert.match(reports.at(-1).error.message, /Secure random source/);
});

test('reports a push tap abandoned after its retries ran out', () => {
  const { reportNotificationFailure, reports } = loadReportFailure();

  // navigate 抛错重试成功(用户只是卡一下)和重试耗尽被永久丢弃(点了永远没反应)
  // 严重度完全不同,但 'navigate' 那条报告的 error/stack/context 一模一样,去重后
  // 连出现次数都看不出来。终态必须自己发一条,否则这个区别在 Sentry 里不存在。
  reportNotificationFailure(
    'notification_navigate_abandoned',
    new Error('push tap dropped: navigate-failed'),
    { source: 'system_push', reason: 'navigate-failed' },
  );

  assert.equal(reports.length, 1);
  assert.equal(reports[0].context.kind, 'notification_navigate_abandoned');
  assert.equal(reports[0].context.reason, 'navigate-failed');
});

test('an API failure does not consume the per-session budget', () => {
  const { reportNotificationFailure, reports } = loadReportFailure();

  // 先来一个被跳过的 ApiError,不能把同事件后续真正该报的原生错误一起吃掉。
  reportNotificationFailure('push_token_register_failed', new ApiError(500), {});
  assert.equal(reports.length, 0);

  reportNotificationFailure('push_token_register_failed', new Error('native'), {});
  assert.equal(reports.length, 1);
});

test('reports a push tap that never reached its screen', () => {
  const { reportNotificationFailure, reports } = loadReportFailure();

  // 「点了推送什么都没发生」是推送的全部意义所在,却一直只有 dev 日志。
  reportNotificationFailure(
    'notification_navigate_failed',
    new Error('no route for screen'),
    { notificationId: 'n1', source: 'system_push' },
  );

  assert.equal(reports.length, 1);
  assert.equal(reports[0].context.kind, 'notification_navigate_failed');
});

test('navigation failures discard route and user text before Sentry', () => {
  const { reportNotificationFailure, reports } = loadReportFailure();
  const rawError = new Error(
    'No route for /chat/detail?nickname=Alice&conversationID=conv-secret&messageID=msg-secret',
  );
  rawError.stack = `${rawError.message}\n    at /profile/Alice`;

  reportNotificationFailure('notification_navigate_failed', rawError, {
    notificationId: 'notification-1',
    source: 'system_push',
  });

  assert.equal(reports.length, 1);
  assert.equal(reports[0].error.name, 'NotificationNavigationError');
  assert.equal(reports[0].error.message, 'Notification navigation failed');
  assert.doesNotMatch(
    `${reports[0].error.message}\n${reports[0].error.stack ?? ''}`,
    /Alice|conv-secret|msg-secret|\/chat\/detail|\/profile\//,
  );
});

test('caller context cannot clobber the fingerprint tags', () => {
  const { reportNotificationFailure, reports } = loadReportFailure();

  reportNotificationFailure('push_token_register_failed', new Error('boom'), {
    operation: 'caller-supplied',
    kind: 'caller-supplied',
  });

  assert.equal(reports[0].context.operation, 'notifications');
  assert.equal(reports[0].context.kind, 'push_token_register_failed');
});

// 上面的用例把 reportError 打了桩,只证明「我们传了什么」。这条接真的
// observability/sentry.ts,证明「传过去之后真的被分成一个稳定的 issue」——
// 两个模块之间的这层契约(operation/kind → tags → fingerprint)才是会悄悄错掉的地方。
test('the real sentry sink turns the reported context into a stable fingerprint', () => {
  const captured = [];
  const { reportError } = loadTsModule('src/observability/sentry.ts', {
    requireShim: (request) => {
      switch (request) {
        case '@sentry/react-native':
          return { init() {}, wrap: (component) => component, captureException() {} };
        case 'expo-constants':
          return { default: { expoConfig: { extra: {} } } };
        case '@/utils/client-diagnostics':
          // #75 让 sentry.ts 从 client-diagnostics 拉 breadcrumbs；本测试不测
          // breadcrumbs，给个返回空数组的实现即可（否则 @ 别名在 requireShim 里解析失败）。
          return { readDiagnosticBreadcrumbs: () => [] };
        default:
          return require(request);
      }
    },
    context: { __DEV__: false, process: { env: {} }, console },
  });

  reportError(
    new Error('Default FirebaseApp is not initialized'),
    {
      platform: 'android',
      operation: 'notifications',
      kind: 'push_token_register_failed',
    },
    { captureException: (error, context) => captured.push({ error, context }) },
  );

  assert.equal(captured.length, 1);
  const { context } = captured[0];
  // 跨 vm realm 比对:deepStrictEqual 会因 prototype 不同而失败,逐字段断言。
  assert.equal(context.tags.operation, 'notifications');
  assert.equal(context.tags.kind, 'push_token_register_failed');
  // 按 message 分组会让同一故障因机型/语言差异碎成一堆 issue,这里必须是稳定三元组。
  assert.equal(
    context.fingerprint.join('|'),
    'notifications|push_token_register_failed|error',
  );
  assert.equal(context.extra.platform, 'android');
});

test('the real sentry sink redacts secrets a caller puts in the context', () => {
  const captured = [];
  const { reportError } = loadTsModule('src/observability/sentry.ts', {
    requireShim: (request) => {
      switch (request) {
        case '@sentry/react-native':
          return { init() {}, wrap: (component) => component, captureException() {} };
        case 'expo-constants':
          return { default: { expoConfig: { extra: {} } } };
        case '@/utils/client-diagnostics':
          // #75 让 sentry.ts 从 client-diagnostics 拉 breadcrumbs；本测试不测
          // breadcrumbs，给个返回空数组的实现即可（否则 @ 别名在 requireShim 里解析失败）。
          return { readDiagnosticBreadcrumbs: () => [] };
        default:
          return require(request);
      }
    },
    context: { __DEV__: false, process: { env: {} }, console },
  });

  // 通知链路今天不传密钥,但 context 是调用方自由传的:守住「即使传了也出不去」。
  // revocationSecret 是这个模块的另一个密钥,而 sentry.ts 的表与 utils/redact.ts 的
  // 是两份,曾经分叉过——redact 有它,sentry 漏了。两个都要拦住。
  reportError(
    new Error('boom'),
    {
      operation: 'notifications',
      kind: 'push_token_register_failed',
      token: 'ExponentPushToken[secret]',
      revocationSecret: 'e1f9-SECRET-VALUE',
    },
    { captureException: (error, context) => captured.push({ error, context }) },
  );

  const serialized = JSON.stringify(captured[0].context);
  assert.doesNotMatch(serialized, /ExponentPushToken\[secret\]/);
  assert.doesNotMatch(serialized, /e1f9-SECRET-VALUE/);
  assert.equal(captured[0].context.extra.token, '[REDACTED]');
  assert.equal(captured[0].context.extra.revocationSecret, '[REDACTED]');
});

test('dev diagnostics keep firing for failures Sentry deliberately skips', () => {
  const { reportNotificationFailure, diagnostics, warnCalls } = loadReportFailure({
    dev: true,
  });

  // 生产不报 != 本地不可见:dev 的两条线索必须原样保留。
  reportNotificationFailure('notification_delete_failed', new ApiError(404), {
    notificationId: 'n1',
  });

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0][0], 'notification_delete_failed');
  assert.equal(warnCalls.length, 1);
});
