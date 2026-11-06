const test = require("node:test");
const assert = require("node:assert/strict");
const { loadTsModule } = require("./helpers/load-ts-module");

// 遥测指标的契约：名字、单位、属性键与取值都来自 observability/metrics.ts 的一张表。
// 表外的名字整条丢弃，表外的属性键或取值被剥掉 —— 用户、会话、房间、消息标识与
// 内容都不可能经由指标进 Sentry。sentry.ts 的 beforeSendMetric 再按同一张表过一遍
// （SDK 会自动往属性里塞 user.id / user.email，那一层兜住它）。

function recordingSdk() {
  const calls = [];
  return {
    calls,
    sdk: {
      metrics: {
        count: (name, value, options) => calls.push({ type: "counter", name, value, options }),
        distribution: (name, value, options) => calls.push({ type: "distribution", name, value, options }),
      },
    },
  };
}

function loadMetrics(sdk) {
  return loadTsModule("src/observability/metrics.ts", {
    requireShim: (request) => {
      if (request === "@sentry/react-native") return sdk;
      return require(request);
    },
  });
}

function loadSentryInit() {
  const initCalls = [];
  const sentry = loadTsModule("src/observability/sentry.ts", {
    requireShim: (request) => {
      if (request === "@sentry/react-native") return { init() {}, wrap: (c) => c, captureException() {} };
      if (request === "expo-constants") return { default: { expoConfig: { extra: {} } } };
      if (request === "@/utils/client-diagnostics") return { readDiagnosticBreadcrumbs: () => [] };
      return require(request);
    },
    context: { __DEV__: false, process: { env: {} }, console },
  });
  sentry.initSentry({ client: { init: (o) => initCalls.push(o), wrap: (c) => c }, dsn: "https://a@o/1" });
  return initCalls[0];
}

const plain = (value) => JSON.parse(JSON.stringify(value));

test("known metrics are recorded with their fixed type, unit and allowed attributes", () => {
  const { sdk, calls } = recordingSdk();
  const { recordMetric } = loadMetrics(sdk);

  recordMetric("push.opened", 1, { provider: "jpush", category: "chat" });
  recordMetric("call.connect.duration", 812, { outcome: "connected" });

  assert.deepEqual(plain(calls), [
    { type: "counter", name: "push.opened", value: 1, options: { attributes: { provider: "jpush", category: "chat" } } },
    {
      type: "distribution",
      name: "call.connect.duration",
      value: 812,
      options: { unit: "millisecond", attributes: { outcome: "connected" } },
    },
  ]);
});

test("note operations retain their allowed outcome labels without note identifiers", () => {
  const { sdk, calls } = recordingSdk();
  const { recordMetric } = loadMetrics(sdk);
  for (const operation of ['noteCreate', 'noteUpdate', 'noteCollect']) {
    recordMetric('app.operation.duration', 1200, { operation, outcome: 'success', noteId: 'private-note' });
  }
  assert.deepEqual(plain(calls.map((call) => call.options.attributes)), [
    { operation: 'noteCreate', outcome: 'success' },
    { operation: 'noteUpdate', outcome: 'success' },
    { operation: 'noteCollect', outcome: 'success' },
  ]);
});

test("attribute keys and values outside the table are stripped", () => {
  const { sdk, calls } = recordingSdk();
  const { recordMetric } = loadMetrics(sdk);

  recordMetric("push.received", 1, {
    provider: "jpush",
    category: "private message preview",
    conversationId: "c-private",
    userId: "u-1",
  });

  assert.deepEqual(plain(calls[0].options.attributes), { provider: "jpush" });
  assert.doesNotMatch(JSON.stringify(calls), /private|c-private|u-1/);
});

test('client request and operation metrics retain bounded labels through the final privacy hook', () => {
  const options = loadSentryInit();
  const kept = options.beforeSendMetric({
    name: 'api.request.duration', type: 'distribution', value: 85,
    attributes: { route: '/collections/:id', method: 'GET', outcome: 'body-read',
      requestId: 'private-request', 'user.id': 'private-user' },
  });
  assert.equal(kept.unit, 'millisecond');
  assert.deepEqual(plain(kept.attributes), { method: 'GET', route: '/collections/:id', outcome: 'body-read' });
  const droppedLabels = options.beforeSendMetric({
    name: 'api.request.duration', type: 'distribution', value: 10,
    attributes: { route: '/collections/private-id?token=secret', method: 'private-method', outcome: 'raw error text' },
  });
  assert.deepEqual(plain(droppedLabels.attributes), {});
  const operation = options.beforeSendMetric({
    name: 'app.operation.duration', type: 'distribution', value: 100,
    attributes: { operation: 'mediaUpload', outcome: 'failed', url: 'https://private-file' },
  });
  assert.deepEqual(plain(operation.attributes), { operation: 'mediaUpload', outcome: 'failed' });
  assert.doesNotMatch(JSON.stringify([kept, droppedLabels, operation]), /private-|token|secret|raw error/);
});

test("unknown metric names and invalid values are dropped, and SDK failures never throw", () => {
  const { sdk, calls } = recordingSdk();
  const { recordMetric } = loadMetrics(sdk);
  recordMetric("chat.message.preview", 1, {});
  recordMetric("call.connect.duration", Number.NaN, { outcome: "connected" });
  recordMetric("call.connect.duration", -5, { outcome: "connected" });
  assert.equal(calls.length, 0);

  const broken = loadMetrics({ metrics: { count: () => { throw new Error("sdk down"); } } });
  assert.doesNotThrow(() => broken.recordMetric("push.opened", 1, { provider: "expo" }));
  assert.doesNotThrow(() => loadMetrics({}).recordMetric("push.opened", 1, { provider: "expo" }));
});

test("beforeSendMetric keeps only table metrics and strips SDK-added identity", () => {
  const options = loadSentryInit();
  assert.equal(typeof options.beforeSendMetric, "function");

  const kept = options.beforeSendMetric({
    name: "push.opened",
    type: "counter",
    value: 1,
    unit: "bogus",
    attributes: {
      provider: "expo",
      category: "circle",
      "user.id": "backend-user-1",
      "user.email": "person@example.test",
      "sentry.release": "windnote@v1.2.3",
      "sentry.environment": "production",
      roomName: "private-room",
    },
  });
  assert.deepEqual(plain(kept), {
    name: "push.opened",
    type: "counter",
    value: 1,
    attributes: {
      provider: "expo",
      category: "circle",
      "sentry.release": "windnote@v1.2.3",
      "sentry.environment": "production",
    },
  });

  assert.equal(options.beforeSendMetric({ name: "custom.free", type: "counter", value: 1, attributes: {} }), null);
  assert.equal(options.beforeSendMetric({ name: "push.opened", type: "distribution", value: 1, attributes: {} }), null);
});
