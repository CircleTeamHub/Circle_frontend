const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

function setup(breadcrumbs = []) {
  let options;
  const captures = [];
  const sdk = {
    init: value => { options = value; },
    captureException: (error, context) => captures.push({ error, context }),
    wrap: component => component,
  };
  const sentry = loadTsModule('src/observability/sentry.ts', {
    requireShim: request => {
      if (request === '@sentry/react-native') return sdk;
      if (request === 'expo-constants') return { default: { expoConfig: { extra: {} } } };
      if (request === '@/utils/client-diagnostics') return { readDiagnosticBreadcrumbs: () => breadcrumbs };
      return require(request);
    },
    context: { __DEV__: false, process: { env: {} }, console },
  });
  sentry.initSentry({ dsn: 'https://synthetic@example.invalid/42' });
  return { sentry, options, captures };
}

test('a handled native-resource failure stays readable after the final privacy filter', () => {
  const { sentry, options, captures } = setup();
  const error = new Error('Unable to find the native shared object associated with given JavaScript object; private chat blue pineapple token=secret');
  sentry.reportError(error, { component: 'RouteErrorBoundary', operation: 'render', kind: 'route' });
  const capture = captures[0];
  const event = options.beforeSend({
    ...capture.context,
    exception: { values: [{ type: capture.error.name, value: capture.error.message,
      stacktrace: { frames: [{ filename: 'app:///main.jsbundle', function: 'pause', lineno: 1, colno: 123 }] },
    }] },
  });

  assert.equal(event.exception.values[0].value, '页面显示或退出失败｜原生资源已释放或不可用');
  assert.equal(event.exception.values[0].stacktrace.frames[0].function, 'pause');
  assert.equal(event.tags.component, 'RouteErrorBoundary');
  assert.doesNotMatch(JSON.stringify(event), /blue pineapple|token=secret|REDACTED_EXCEPTION/);
  assert.equal(options.beforeSend(event).exception.values[0].value, event.exception.values[0].value);
  assert.equal(capture.context.fingerprint[0], '{{ default }}');
});

test('unrecognized raw errors get a readable type explanation without leaking their text', () => {
  const { options } = setup();
  const event = options.beforeSend({
    message: '张三的私密聊天 token=secret',
    exception: { values: [{ type: 'TypeError', value: '张三的私密聊天 token=secret' }] },
  });
  assert.equal(event.exception.values[0].value, '应用异常｜类型错误：调用或数据类型不符合预期');
  assert.match(event.message, /应用异常/);
  assert.doesNotMatch(JSON.stringify(event), /张三|私密聊天|secret|REDACTED_EXCEPTION/);
});

test('response contract failures retain a readable cause through capture and final sanitization', () => {
  const { sentry, options, captures } = setup();
  const { expectShape } = loadTsModule('src/utils/validate.ts', {
    requireShim: request => request === '@/observability/sentry' ? sentry : require(request),
  });
  assert.throws(() => expectShape({ privateText: 'private-payload' }, () => false, 'private-server-message'));
  assert.equal(captures.length, 1);
  const capture = captures[0];
  const event = options.beforeSend({ ...capture.context,
    exception: { values: [{ type: capture.error.name, value: capture.error.message }] },
  });
  assert.match(event.exception.values[0].value, /服务端返回的数据结构不符合预期/);
  assert.equal(event.tags.component, 'ResponseValidation');
  assert.doesNotMatch(JSON.stringify(event), /private-payload|private-server-message|privateText/);
});

test('automatic errors include timestamped local diagnostics and safe previous/current routes', () => {
  const { sentry, options } = setup([
    { event: 'api.request.failed', timestamp: 1762300000000, details: { method: 'GET', endpointPath: '/collections', status: 0 } },
  ]);
  sentry.setSentryRoute('/(tabs)/profile/collections');
  sentry.setSentryRoute('/(tabs)/profile/user/private-person');
  const event = options.beforeSend({ exception: { values: [{ type: 'TypeError', value: 'private content' }] } });
  assert.equal(event.tags.currentRoute, '/(tabs)/profile/user/:id');
  assert.equal(event.tags.previousRoute, '/(tabs)/profile/collections');
  assert.equal(event.extra.clientDiagnostics[0].timestamp, 1762300000000);
  assert.match(event.extra.clientDiagnostics[0].summary, /请求失败/);
  assert.doesNotMatch(JSON.stringify(event), /private-person|private content/);
});

test('manual capture retains the route and diagnostic snapshot at capture time', () => {
  const { sentry, options, captures } = setup([
    { event: 'route.render.failed', timestamp: 1762300000000, details: { stage: 'errorBoundary' } },
  ]);
  sentry.setSentryRoute('/(tabs)/profile/collections');
  sentry.reportError(new Error('private content'), { operation: 'render', kind: 'route' });
  sentry.setSentryRoute('/(tabs)/messages');
  const event = options.beforeSend({ ...captures[0].context, exception: { values: [{ type: 'Error', value: 'private content' }] } });
  assert.equal(event.tags.currentRoute, '/(tabs)/profile/collections');
  assert.equal(event.extra.clientDiagnostics[0].timestamp, 1762300000000);
});

test('network error titles explain the missing response and retain safe request metadata', () => {
  const { sentry, options, captures } = setup();
  sentry.reportError(new Error('Network request failed Bearer private-token'), {
    endpointPath: '/collections', method: 'GET', status: 0, durationMs: 12, failureKind: 'network',
  });
  const capture = captures[0];
  const event = options.beforeSend({
    ...capture.context,
    exception: { values: [{ type: capture.error.name, value: capture.error.message }] },
  });
  assert.equal(event.exception.values[0].value, '接口请求失败｜GET /collections｜未收到响应｜12 ms｜网络连接失败');
  assert.equal(event.tags.status, '0');
  assert.equal(event.level, undefined);
  assert.doesNotMatch(JSON.stringify(event), /Bearer|private-token/);
});

// 卡顿检查叫停的 GET 换新请求重试：救回来用户无感，只留现场，不该按 error 触发高优先级告警；
// 标题要说清是「卡住」以及重试结果，不能落到「运行时错误」。
test('a stalled request rescued by the retry reads as such and is reported as a warning', () => {
  const { sentry, options, captures } = setup();
  sentry.reportError(new Error('Aborted'), {
    endpointPath: '/privacy/settings', method: 'GET', status: 0, durationMs: 8007,
    failureKind: 'stalled', retry: 'recovered', attempts: 1,
  });
  const capture = captures[0];
  assert.equal(capture.context.level, 'warning');
  const event = options.beforeSend({
    ...capture.context,
    exception: { values: [{ type: capture.error.name, value: capture.error.message }] },
  });
  assert.equal(event.exception.values[0].value, '接口请求失败｜GET /privacy/settings｜未收到响应｜8007 ms｜请求卡住无响应｜重试已救回');
  assert.equal(event.level, 'warning');
  assert.equal(event.tags.retry, 'recovered');
});

test('a JS thread stall reads as such with its length instead of a generic runtime error', () => {
  const { sentry, options, captures } = setup();
  sentry.reportError(new Error('JS thread stalled'), { operation: 'jsThread', kind: 'stall', durationMs: 8123 });
  const capture = captures[0];
  const event = options.beforeSend({
    ...capture.context,
    exception: { values: [{ type: capture.error.name, value: capture.error.message }] },
  });
  assert.equal(event.exception.values[0].value, 'JS 线程卡顿｜8123 ms');
  assert.deepEqual([...capture.context.fingerprint], ['jsThread', 'stall', 'error']);
});

test('a retry that also failed names the outcome and stays an error', () => {
  const { sentry, options, captures } = setup();
  sentry.reportError(new Error('Network request failed'), {
    endpointPath: '/chat/conversations/:id/messages', method: 'GET', status: 0, durationMs: 9725,
    failureKind: 'network', retry: 'failed', attempts: 2,
  });
  const capture = captures[0];
  assert.equal(capture.context.level, undefined);
  const event = options.beforeSend({
    ...capture.context,
    exception: { values: [{ type: capture.error.name, value: capture.error.message }] },
  });
  assert.equal(event.exception.values[0].value, '接口请求失败｜GET /chat/conversations/:id/messages｜未收到响应｜9725 ms｜网络连接失败｜重试也失败');

  sentry.reportError(new Error('Aborted'), {
    endpointPath: '/friend', method: 'GET', status: 0, durationMs: 8010,
    failureKind: 'stalled', retry: 'failed', attempts: 2,
  });
  assert.equal(captures[1].error.message, '接口请求失败｜GET /friend｜未收到响应｜8010 ms｜请求卡住无响应｜重试也失败');
  assert.equal(captures[1].context.level, undefined);
});

test('every client-side failure kind gets its own explanation instead of the generic runtime error', () => {
  const { sentry, captures } = setup();
  sentry.reportError(new Error('Aborted'), {
    endpointPath: '/note/:id', method: 'GET', status: 200, durationMs: 15000, failureKind: 'body-read',
  });
  sentry.reportError(new Error('chat connection failed'), {
    operation: 'chatConnect', kind: 'timeout', failureKind: 'connect_error', endpointPath: '/chat-ws',
  });
  assert.equal(captures[0].error.message, '接口请求失败｜GET /note/:id｜HTTP 200｜15000 ms｜读取响应内容失败');
  assert.match(captures[1].error.message, /｜实时连接握手失败$/);
});

test('navigation breadcrumbs retain only normalized from/to routes and a readable message', () => {
  const { options } = setup();
  const breadcrumb = options.beforeBreadcrumb({
    category: 'navigation', type: 'navigation', timestamp: 123,
    message: 'Navigation with private title blue pineapple',
    data: { from: '__root/(tabs)/profile/collections', to: '__root/(tabs)/profile/index', params: { token: 'secret' } },
  });
  assert.equal(breadcrumb.message, '页面跳转：/(tabs)/profile/collections → /(tabs)/profile');
  assert.deepEqual(JSON.parse(JSON.stringify(breadcrumb.data)), {
    from: '/(tabs)/profile/collections', to: '/(tabs)/profile',
  });
  assert.equal(breadcrumb.timestamp, 123);
  assert.equal(options.beforeBreadcrumb(breadcrumb).message, breadcrumb.message);
  assert.doesNotMatch(JSON.stringify(breadcrumb), /blue pineapple|secret|params/);

  const dynamic = options.beforeBreadcrumb({ category: 'navigation', data: {
    from: '__root/(tabs)/messages/user/privatealphabetical', to: 'https://private.test/?token=secret',
  } });
  assert.equal(dynamic.data.from, '/(tabs)/messages/user/:id');
  assert.doesNotMatch(JSON.stringify(dynamic), /privatealphabetical|private\.test|secret/);
});

test('HTTP breadcrumbs show the method, reviewed endpoint and status without URLs or bodies', () => {
  const { options } = setup();
  const breadcrumb = options.beforeBreadcrumb({
    category: 'http', type: 'http',
    data: { method: 'GET', url: 'https://api.example.test/collections?token=secret', status_code: 503, body: 'private chat' },
  });
  assert.equal(breadcrumb.message, '接口请求｜GET /collections｜HTTP 503');
  assert.deepEqual(JSON.parse(JSON.stringify(breadcrumb.data)), { method: 'GET', endpointPath: '/collections', status: 503 });
  assert.equal(options.beforeBreadcrumb(breadcrumb).message, breadcrumb.message);
  assert.doesNotMatch(JSON.stringify(breadcrumb), /example\.test|token|secret|private chat/);
});

test('diagnostic history has readable summaries and keeps bounded request metadata', () => {
  const { sentry, options, captures } = setup([
    { event: 'api.request.failed', details: { endpointPath: '/note/:id', method: 'GET', status: 503, durationMs: 17, body: 'private chat' } },
    { event: 'route.render.failed', details: { stage: 'errorBoundary' } },
  ]);
  sentry.reportError(new Error('private chat'), { component: 'RouteErrorBoundary', operation: 'render', kind: 'route' });
  const event = options.beforeSend(captures[0].context);
  const diagnostics = event.extra.clientDiagnostics;
  assert.equal(diagnostics[0].summary, '请求失败｜GET /note/:id｜HTTP 503｜17 ms');
  assert.equal(diagnostics[0].details.durationMs, 17);
  assert.equal(diagnostics[1].summary, '页面显示或退出失败');
  assert.doesNotMatch(JSON.stringify(event), /private chat/);
});

test('console and touch breadcrumbs do not expose arbitrary messages or labels', () => {
  const { options } = setup();
  for (const category of ['console', 'touch']) {
    const breadcrumb = options.beforeBreadcrumb({ category, message: 'private chat', data: { label: 'secret' } });
    assert.ok(breadcrumb.message.length > 0);
    assert.doesNotMatch(JSON.stringify(breadcrumb), /private chat|secret|REDACTED_BREADCRUMB/);
    assert.equal(breadcrumb.data, undefined);
  }
});
