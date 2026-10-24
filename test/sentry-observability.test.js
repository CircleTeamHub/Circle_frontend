const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const babel = require("@babel/core");

// Loads a TS module under test, stubbing native deps so it runs in plain node.
function load(rel, stubs = {}) {
  const filePath = path.join(process.cwd(), rel);
  const source = fs.readFileSync(filePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filePath,
  }).outputText;
  const context = {
    module: { exports: {} },
    exports: {},
    require: (s) => {
      if (s in stubs) return stubs[s];
      // 相对 import 按同目录的 .ts 递归加载 —— 让测试跑**真实**的依赖模块
      // 而不是空桩。route-segments 那份白名单如果被桩成空集合，这里所有
      // 路由归一化断言都会变成永真。
      if (s.startsWith("./") || s.startsWith("../")) {
        const resolved = path.join(path.dirname(filePath), `${s}.ts`);
        if (fs.existsSync(resolved)) {
          return load(path.relative(process.cwd(), resolved), stubs);
        }
      }
      // 共享脱敏清单要跑真的，否则「两边用的是同一份」无从验证。
      if (s === "@/utils/redact") return load("src/utils/redact.ts", stubs);
      if (s.startsWith("@/")) return {};
      return require(s);
    },
    process: { env: {} },
    __DEV__: false,
    console,
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

function loadSentry(extra = {}) {
  return load("src/observability/sentry.ts", {
    "@sentry/react-native": { init() {}, wrap: (c) => c, captureException() {} },
    "expo-constants": { expoConfig: { extra } },
  });
}

test("resolveSentryDsn prefers EXPO_PUBLIC_SENTRY_DSN over extra", () => {
  const { resolveSentryDsn } = loadSentry();
  const dsn = resolveSentryDsn({
    env: { EXPO_PUBLIC_SENTRY_DSN: "https://a@o/1" },
    extra: { sentryDsn: "https://b@o/2" },
  });
  assert.equal(dsn, "https://a@o/1");
});

test("resolveSentryDsn falls back to extra.sentryDsn", () => {
  const { resolveSentryDsn } = loadSentry();
  const dsn = resolveSentryDsn({ env: {}, extra: { sentryDsn: "https://b@o/2" } });
  assert.equal(dsn, "https://b@o/2");
});

test("resolveSentryDsn returns undefined when blank or unset", () => {
  const { resolveSentryDsn } = loadSentry();
  assert.equal(
    resolveSentryDsn({ env: { EXPO_PUBLIC_SENTRY_DSN: "   " }, extra: { sentryDsn: "" } }),
    undefined,
  );
  assert.equal(resolveSentryDsn({ env: {}, extra: {} }), undefined);
});

test("production Expo transform inlines the public DSN before runtime", () => {
  const previous = process.env.EXPO_PUBLIC_SENTRY_DSN;
  process.env.EXPO_PUBLIC_SENTRY_DSN = "https://synthetic@example.invalid/42";
  let transformed;
  try {
    transformed = babel.transformFileSync(
      path.join(process.cwd(), "src/observability/sentry.ts"),
      {
        envName: "production", babelrc: false,
        configFile: path.join(process.cwd(), "babel.config.js"),
        caller: { name: "metro", bundler: "metro", platform: "ios", isDev: false, isServer: false },
      },
    ).code;
  } finally {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_SENTRY_DSN;
    else process.env.EXPO_PUBLIC_SENTRY_DSN = previous;
  }
  assert.match(transformed, /https:\/\/synthetic@example\.invalid\/42/);
  assert.doesNotMatch(transformed, /process\.env\.EXPO_PUBLIC_SENTRY_DSN/);

  const calls = [];
  const context = {
    module: { exports: {} }, exports: {}, __DEV__: false, console,
    process: { env: {} },
    require: (name) => {
      if (name === "@sentry/react-native") return { init: (o) => calls.push(o), wrap: (c) => c };
      if (name === "expo-constants") return { default: { expoConfig: { extra: {} } } };
      if (name === "@/utils/client-diagnostics") return { readDiagnosticBreadcrumbs: () => [] };
      if (name === "./route-segments") return { STATIC_ROUTE_SEGMENTS: new Set() };
      if (name === "./tracing") return { TRACED_SPAN_NAMES: new Set() };
      if (name === "./unhandled-rejection-filter") return load("src/observability/unhandled-rejection-filter.ts");
      if (name === "./metrics") return load("src/observability/metrics.ts", { "@sentry/react-native": {} });
      if (name === "@/utils/redact") return load("src/utils/redact.ts");
      return require(name);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transformed, context);
  assert.equal(context.module.exports.initSentry(), true);
  assert.equal(calls[0].dsn, "https://synthetic@example.invalid/42");
});

test("environment and sampling inputs use validated deployment defaults", () => {
  const preprod = loadSentry({ appVariant: "preprod" });
  const calls = [];
  const client = { init: (o) => calls.push(o), wrap: (c) => c };
  preprod.initSentry({ client, dsn: "https://a@o/1", tracesSampleRate: Number.NaN });
  assert.equal(calls[0].environment, "preproduction");
  assert.equal(calls[0].tracesSampleRate, 0.05);

  const { initSentry } = loadSentry();
  initSentry({ client, dsn: "https://a@o/1", environment: "canary", tracesSampleRate: 0 });
  assert.equal(calls[1].environment, "canary");
  assert.equal(calls[1].tracesSampleRate, 0);
  initSentry({ client, dsn: "https://a@o/1", tracesSampleRate: 2 });
  assert.equal(calls[2].tracesSampleRate, 0.05);
});

test("initSentry locks privacy-sensitive integrations and replay defaults off", () => {
  const { initSentry } = loadSentry();
  const calls = [];
  initSentry({ client: { init: (o) => calls.push(o), wrap: (c) => c }, dsn: "https://a@o/1" });
  assert.equal(calls[0].attachScreenshot, false);
  assert.equal(calls[0].attachViewHierarchy, false);
  assert.equal(calls[0].enableCaptureFailedRequests, false);
  assert.equal(calls[0].replaysSessionSampleRate, 0);
  assert.equal(calls[0].replaysOnErrorSampleRate, 0);
});

test("initSentry is a no-op without a dsn", () => {
  const { initSentry } = loadSentry();
  const calls = [];
  const client = { init: (o) => calls.push(o), wrap: (c) => c };
  const enabled = initSentry({ client });
  assert.equal(enabled, false);
  assert.equal(calls.length, 0);
});

test("initSentry initializes with the resolved dsn and safe defaults", () => {
  const { initSentry } = loadSentry();
  const calls = [];
  const client = { init: (o) => calls.push(o), wrap: (c) => c };
  const enabled = initSentry({
    client,
    dsn: "https://a@o/1",
    environment: "production",
  });
  assert.equal(enabled, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].dsn, "https://a@o/1");
  assert.equal(calls[0].environment, "production");
  assert.equal(calls[0].sendDefaultPii, false);
  // 采样率的具体取值由下面 "production sampling collects a small share of
  // traces" 那条断言约束（区间而不是定值），这里只保证它被显式设置过，
  // 免得调采样率要改两处。
  assert.equal(typeof calls[0].tracesSampleRate, "number");
});

test("initSentry installs global event and breadcrumb privacy filters", () => {
  const { initSentry } = loadSentry();
  const calls = [];
  initSentry({
    client: { init: (options) => calls.push(options), wrap: (component) => component },
    dsn: "https://a@o/1",
  });

  assert.equal(typeof calls[0].beforeSend, "function");
  assert.equal(typeof calls[0].beforeBreadcrumb, "function");
  assert.equal(typeof calls[0].beforeSendTransaction, "function");
  assert.equal(typeof calls[0].beforeSendSpan, "function");
});

test("global privacy filters redact automatic exception and breadcrumb secrets", () => {
  const { initSentry } = loadSentry();
  const calls = [];
  initSentry({
    client: { init: (options) => calls.push(options), wrap: (component) => component },
    dsn: "https://a@o/1",
  });

  const event = calls[0].beforeSend({
    exception: {
      values: [{ value: "private chat says blue pineapple Bearer top-secret-token" }],
    },
    request: {
      url: "https://api.example.test/download?X-Amz-Signature=secret",
      headers: { Authorization: "Bearer another-secret" },
    },
    extra: { email: "person@example.test", phoneNumber: "+1 415 555 1234" },
    futureSdkField: { caption: "private unknown blue pineapple" },
    threads: {
      values: [
        {
          id: 1,
          crashed: true,
          stacktrace: {
            frames: [
              {
                filename: "src/safe.ts",
                function: "render",
                lineno: 12,
                vars: { caption: "private frame blue pineapple" },
                context_line: "const secret = 'private source text'",
              },
            ],
          },
        },
      ],
    },
  });
  const breadcrumb = calls[0].beforeBreadcrumb({
    message: "private breadcrumb blue pineapple https://store.test/object?token=secret",
    data: { cookie: "session=secret", payload: "private breadcrumb payload" },
  });

  const serialized = JSON.stringify({ event, breadcrumb });
  assert.doesNotMatch(
    serialized,
    /blue pineapple|breadcrumb payload|top-secret-token|another-secret|person@example\.test|415 555 1234|X-Amz-Signature|session=secret/,
  );
  assert.equal(event.futureSdkField, undefined);
  assert.equal(breadcrumb.data, undefined);
  assert.equal(event.threads.values[0].stacktrace.frames[0].filename, "src/safe.ts");
  assert.equal(event.threads.values[0].stacktrace.frames[0].vars, undefined);
  assert.equal(event.threads.values[0].stacktrace.frames[0].context_line, undefined);
});

test("error event sanitizer retains only valid distributed trace context", () => {
  const { initSentry } = loadSentry();
  const calls = [];
  initSentry({ client: { init: (o) => calls.push(o), wrap: (c) => c }, dsn: "https://a@o/1" });
  const event = calls[0].beforeSend({
    contexts: { trace: { trace_id: "a".repeat(32), span_id: "b".repeat(16), parent_span_id: "c".repeat(16), op: "http.client", description: "private" }, device: { name: "private" } },
  });
  assert.equal(event.contexts.trace.trace_id, "a".repeat(32));
  assert.equal(event.contexts.trace.span_id, "b".repeat(16));
  assert.equal(event.contexts.trace.parent_span_id, "c".repeat(16));
  assert.equal(event.contexts.trace.description, undefined);
  assert.equal(event.contexts.device, undefined);
  const invalid = calls[0].beforeSend({ contexts: { trace: { trace_id: "0".repeat(32), span_id: "b".repeat(16) } } });
  assert.equal(invalid.contexts, undefined);
});

// SDK 自动填的设备/系统/App/OTA 上下文。字段名与 @sentry/react-native 7 的
// devicecontext、expocontext 集成一致；标识类字段（设备名、设备 ID、安装哈希、
// 时区与语言、带沙盒路径的回退原因）混在其中，正好用来钉住白名单的两个方向。
function automaticContexts() {
  return {
    device: {
      name: "Alice's iPhone",
      id: "device-uuid-1",
      device_unique_identifier: "unique-device-1",
      model: "iPhone15,2",
      model_id: "D73AP",
      family: "iOS",
      brand: "Apple",
      manufacturer: "Apple",
      arch: "arm64e",
      simulator: false,
      memory_size: 6_000_000_000,
      low_memory: false,
      free_memory: 123_456_789,
      boot_time: "2026-10-01T08:00:00Z",
      timezone: "Asia/Shanghai",
      locale: "zh_CN",
    },
    os: {
      name: "iOS",
      version: "18.1",
      build: "22B83",
      kernel_version: "Darwin Kernel Version 24.1.0 alice-macbook.local",
      rooted: false,
    },
    app: {
      app_version: "1.4.0",
      app_build: "140",
      app_identifier: "com.windnote.app",
      app_name: "WindNote",
      build_type: "app-store",
      in_foreground: true,
      device_app_hash: "install-hash-1",
      app_start_time: "2026-10-01T08:00:01Z",
      view_names: ["__root/(tabs)/messages/user/[id]"],
    },
    ota_updates: {
      is_enabled: true,
      update_id: "0f9c2b4e-6a1d-4c3e-9b7a-2d5e8f1a3c6b",
      channel: "production",
      runtime_version: "1.4.0",
      check_automatically: "on_load",
      is_embedded_launch: false,
      is_emergency_launch: true,
      is_using_embedded_assets: false,
      emergency_launch_reason:
        "/var/mobile/Containers/Data/Application/5A1B2C3D/.expo-internal/update failed",
      launch_duration: 120,
      created_at: "2026-10-01T00:00:00.000Z",
    },
    culture: { locale: "zh-CN", timezone: "Asia/Shanghai" },
    profile: { caption: "private profile blue pineapple" },
  };
}

const EXPECTED_SAFE_CONTEXTS = {
  device: {
    model: "iPhone15,2",
    model_id: "D73AP",
    family: "iOS",
    brand: "Apple",
    manufacturer: "Apple",
    arch: "arm64e",
    simulator: false,
    memory_size: 6_000_000_000,
    low_memory: false,
  },
  os: { name: "iOS", version: "18.1", build: "22B83" },
  app: {
    app_version: "1.4.0",
    app_build: "140",
    app_identifier: "com.windnote.app",
    app_name: "WindNote",
    build_type: "app-store",
    in_foreground: true,
    // 路由名是代码里的文件名（不含参数值），归一化成与 transaction 同一种形状。
    view_names: ["/(tabs)/messages/user/[param]"],
  },
  ota_updates: {
    is_enabled: true,
    update_id: "0f9c2b4e-6a1d-4c3e-9b7a-2d5e8f1a3c6b",
    channel: "production",
    runtime_version: "1.4.0",
    check_automatically: "on_load",
    is_embedded_launch: false,
    is_emergency_launch: true,
    is_using_embedded_assets: false,
    launch_duration: 120,
    created_at: "2026-10-01T00:00:00.000Z",
  },
};

const IDENTIFYING_CONTEXT_VALUES =
  /Alice|device-uuid-1|unique-device-1|install-hash-1|Asia\/Shanghai|zh_CN|zh-CN|alice-macbook|Containers|5A1B2C3D|123456789|blue pineapple|2026-10-01T08/;

test("error events keep non-identifying device, os, app and OTA context", () => {
  // 之前只留 contexts.trace：没法按机型、系统版本、App 版本或 OTA 版本筛崩溃。
  const { initSentry } = loadSentry();
  const calls = [];
  initSentry({ client: { init: (o) => calls.push(o), wrap: (c) => c }, dsn: "https://a@o/1" });

  const event = calls[0].beforeSend({
    contexts: {
      ...automaticContexts(),
      trace: { trace_id: "a".repeat(32), span_id: "b".repeat(16) },
    },
  });

  const { trace, ...rest } = JSON.parse(JSON.stringify(event.contexts));
  assert.equal(trace.trace_id, "a".repeat(32));
  assert.deepEqual(rest, EXPECTED_SAFE_CONTEXTS);
  assert.doesNotMatch(JSON.stringify(event), IDENTIFYING_CONTEXT_VALUES);
});

test("transaction events keep the same non-identifying context allowlist", () => {
  const { initSentry } = loadSentry();
  const calls = [];
  initSentry({ client: { init: (o) => calls.push(o), wrap: (c) => c }, dsn: "https://a@o/1" });

  const transaction = calls[0].beforeSendTransaction({
    type: "transaction",
    transaction: "/settings",
    start_timestamp: 1,
    timestamp: 2,
    contexts: {
      ...automaticContexts(),
      trace: { trace_id: "a".repeat(32), span_id: "b".repeat(16), op: "navigation" },
    },
  });

  const { trace, ...rest } = JSON.parse(JSON.stringify(transaction.contexts));
  assert.equal(trace.op, "navigation");
  assert.deepEqual(rest, EXPECTED_SAFE_CONTEXTS);
  assert.doesNotMatch(JSON.stringify(transaction), IDENTIFYING_CONTEXT_VALUES);
});

test("context allowlist keeps only bounded primitive values", () => {
  const { initSentry } = loadSentry();
  const calls = [];
  initSentry({ client: { init: (o) => calls.push(o), wrap: (c) => c }, dsn: "https://a@o/1" });

  const event = calls[0].beforeSend({
    contexts: {
      device: {
        model: { nested: "private blue pineapple" },
        brand: "x".repeat(200),
        family: "Bearer top-secret-token",
        memory_size: Number.NaN,
      },
      os: { name: ["iOS"] },
      app: { view_names: "not-an-array", app_version: "1.4.0" },
      ota_updates: "not-an-object",
    },
  });

  assert.deepEqual(JSON.parse(JSON.stringify(event.contexts)), {
    device: { family: "Bearer [REDACTED]" },
    app: { app_version: "1.4.0" },
  });
});

test("transaction and span filters sanitize nested request data", () => {
  const { initSentry } = loadSentry();
  const calls = [];
  initSentry({
    client: { init: (options) => calls.push(options), wrap: (component) => component },
    dsn: "https://a@o/1",
  });

  const transaction = calls[0].beforeSendTransaction({
    type: "transaction",
    event_id: "event-1",
    transaction: "private route /users/person-1",
    start_timestamp: 1,
    timestamp: 2,
    contexts: {
      trace: {
        trace_id: "a".repeat(32),
        span_id: "b".repeat(16),
        op: "navigation",
        data: { caption: "private trace context" },
      },
    },
    request: { headers: { authorization: "Bearer secret" } },
    description: "private transaction blue pineapple",
    data: { caption: "private transaction payload" },
    spans: [
      {
        data: { "http.url": "https://private.test/user/1", "sentry.op": "http.client" },
        description: "private child span",
        op: "http.client",
        span_id: "c".repeat(16),
        start_timestamp: 1.1,
        timestamp: 1.2,
        trace_id: "a".repeat(32),
      },
    ],
  });
  const span = calls[0].beforeSendSpan({
    data: { uploadUrl: "https://store.test/object?X-Amz-Signature=secret" },
    description: "private span blue pineapple",
    op: "file.upload",
    span_id: "d".repeat(16),
    start_timestamp: 1,
    timestamp: 2,
    trace_id: "a".repeat(32),
  });

  assert.doesNotMatch(
    JSON.stringify({ transaction, span }),
    /Bearer secret|X-Amz-Signature|blue pineapple|transaction payload/,
  );
  assert.equal(transaction.type, "transaction");
  assert.equal(transaction.contexts.trace.trace_id, "a".repeat(32));
  assert.equal(transaction.contexts.trace.span_id, "b".repeat(16));
  assert.deepEqual({ ...transaction.contexts.trace.data }, {});
  assert.equal(transaction.spans[0].span_id, "c".repeat(16));
  assert.deepEqual({ ...transaction.spans[0].data }, { "sentry.op": "http.client" });
  assert.equal(span.span_id, "d".repeat(16));
  assert.deepEqual({ ...span.data }, {});
});

test("transaction sanitizer validates trace ids and preserves known measurements", () => {
  const { initSentry } = loadSentry();
  const calls = [];
  initSentry({ client: { init: (o) => calls.push(o), wrap: (c) => c }, dsn: "https://a@o/1" });
  const sanitize = calls[0].beforeSendTransaction;
  const event = sanitize({
    type: "transaction", transaction: "/settings", start_timestamp: 1, timestamp: 2,
    contexts: { trace: { trace_id: "a".repeat(32), span_id: "b".repeat(16), parent_span_id: "c".repeat(16), op: "navigation", origin: "manual.ui", status: "ok", description: "private" } },
    measurements: {
      app_start_cold: { value: 123, unit: "millisecond" }, frames_total: { value: 60, unit: "none" },
      frames_slow: { value: -1, unit: "none" }, arbitrary: { value: 4, unit: "byte" },
    },
  });
  assert.equal(event.contexts.trace.parent_span_id, "c".repeat(16));
  assert.equal(event.contexts.trace.description, undefined);
  assert.equal(event.contexts.trace.origin, "manual.ui");
  assert.deepEqual(JSON.parse(JSON.stringify(event.measurements)), {
    app_start_cold: { value: 123, unit: "millisecond" }, frames_total: { value: 60, unit: "none" },
  });
  const malformed = sanitize({ type: "transaction", transaction: "/settings", contexts: { trace: { trace_id: "0".repeat(32), span_id: "x".repeat(16) } } });
  assert.equal(malformed.contexts, undefined);
  const unbounded = sanitize({ type: "transaction", transaction: "/settings", contexts: { trace: {
    trace_id: "a".repeat(32), span_id: "b".repeat(16), op: "private".repeat(20), origin: "bad value",
  } } });
  assert.equal(unbounded.contexts.trace.op, undefined);
  assert.equal(unbounded.contexts.trace.origin, undefined);
  const malformedSpan = sanitize({
    type: "transaction", transaction: "/settings",
    spans: [{ trace_id: "a".repeat(32), span_id: "0".repeat(16), start_timestamp: 1, description: "private" }],
  });
  assert.deepEqual(malformedSpan.spans, []);
});

test("final diagnostics sanitizer validates bounded HTTP metadata", () => {
  const { initSentry } = loadSentry();
  const calls = [];
  initSentry({ client: { init: (o) => calls.push(o), wrap: (c) => c }, dsn: "https://a@o/1" });
  const event = calls[0].beforeSend({ extra: { clientDiagnostics: [{
    event: "api.request.failed", details: {
      endpointPath: "/notes/:id", method: "GET", status: 503, durationMs: 8,
      requestId: "123e4567-e89b-42d3-a456-426614174000", failureKind: "http",
      token: "secret",
    },
  }, {
    event: "api.request.failed", details: {
      endpointPath: "https://evil.test/private?token=x", method: "TRACE", status: 999,
      durationMs: Infinity, requestId: "bad", failureKind: "bad value!",
    },
  }] } });
  assert.deepEqual(JSON.parse(JSON.stringify(event.extra.clientDiagnostics[0].details)), {
    endpointPath: "/notes/:id", method: "GET", status: 503, durationMs: 8,
    requestId: "123e4567-e89b-42d3-a456-426614174000", failureKind: "http",
  });
  assert.deepEqual(JSON.parse(JSON.stringify(event.extra.clientDiagnostics[1].details)), {});
  assert.doesNotMatch(JSON.stringify(event), /evil|secret|TRACE|999/);
});

test("initSentry attaches explicit release and distribution identifiers", () => {
  const { initSentry } = loadSentry();
  const calls = [];
  initSentry({
    client: { init: (options) => calls.push(options), wrap: (component) => component },
    dsn: "https://a@o/1",
    release: "windnote@v1.2.3",
    dist: "1002003",
  });

  assert.equal(calls[0].release, "windnote@v1.2.3");
  assert.equal(calls[0].dist, "1002003");
});

test("setSentryUserId never sends the backend account id", () => {
  const { setSentryUserId } = loadSentry();
  const calls = [];
  const client = { setUser: (user) => calls.push(user) };

  assert.equal(typeof setSentryUserId, "function");
  setSentryUserId(" user-1 ", client);
  setSentryUserId(null, client);

  assert.equal(calls.length, 2);
  assert.equal(calls[0], null);
  assert.equal(calls[1], null);
});

test("beforeSend preserves reportError allowlisted extra but removes account identity", () => {
  const { initSentry, reportError } = loadSentry();
  const initCalls = [];
  initSentry({
    dsn: "https://a@o/1",
    client: { init: (options) => initCalls.push(options), wrap: (component) => component },
  });
  const captures = [];
  reportError(new Error("boom"), { attempts: 3, platform: "ios", stage: "connect" }, {
    captureException: (error, context) => captures.push({ error, context }),
  });

  const event = initCalls[0].beforeSend({
    exception: { values: [{ type: "Error", value: captures[0].error.message }] },
    extra: {
      ...captures[0].context.extra,
      clientDiagnostics: [{ event: "api.request", details: { stage: "connect", page: 1 } }],
      token: "secret-token",
    },
    user: { id: "backend-user-1" },
  });

  assert.equal(event.extra.attempts, 3);
  assert.equal(event.extra.platform, "ios");
  assert.equal(event.extra.stage, "connect");
  assert.equal(
    JSON.stringify(event.extra.clientDiagnostics),
    JSON.stringify([
      { event: "api.request", details: { stage: "connect", page: 1 } },
    ]),
  );
  assert.equal(event.extra.token, undefined);
  assert.equal(event.user, undefined);
  assert.doesNotMatch(JSON.stringify(event), /backend-user-1|secret-token/);
});

test("wrapWithSentry wraps only when enabled", () => {
  const { wrapWithSentry } = loadSentry();
  const wrapped = { wrapped: true };
  const client = { init() {}, wrap: () => wrapped };
  const Comp = () => null;
  assert.equal(wrapWithSentry(Comp, { client, enabled: true }), wrapped);
  assert.equal(wrapWithSentry(Comp, { client, enabled: false }), Comp);
});

test("wrapWithSentry returns the original component when the SDK throws", () => {
  const { wrapWithSentry } = loadSentry();
  const Comp = () => null;
  const client = {
    init() {},
    wrap: () => {
      throw new Error("Sentry wrap unavailable");
    },
  };

  assert.doesNotThrow(() => wrapWithSentry(Comp, { client, enabled: true }));
  assert.equal(wrapWithSentry(Comp, { client, enabled: true }), Comp);
});

test("root layout initializes and wraps with Sentry", () => {
  const layout = fs.readFileSync(
    path.join(process.cwd(), "app/_layout.tsx"),
    "utf8",
  );
  assert.match(layout, /from ['"]@\/observability\/sentry['"]/);
  assert.match(layout, /\binitSentry\(\)/);
  assert.match(layout, /export default wrapWithSentry\(\s*RootLayout\s*\)/);
});

test("root layout clears Sentry user context on authentication changes", () => {
  const layout = fs.readFileSync(
    path.join(process.cwd(), "app/_layout.tsx"),
    "utf8",
  );
  assert.match(layout, /\bsetSentryUserId\(/);
  assert.match(layout, /state\.user\?\.id/);
});

test("reportError forwards to captureException with extra context", () => {
  const { reportError } = loadSentry();
  const calls = [];
  const client = { captureException: (e, ctx) => calls.push([e, ctx]) };
  const err = new Error("boom");

  reportError(err, { endpoint: "/api/v1/x", status: 500 }, client);

  assert.equal(calls.length, 1);
  assert.notEqual(calls[0][0], err);
  assert.equal(calls[0][0].message, "handled application error");
  // Property-level checks: the captureContext object is built inside the
  // vm-loaded module (a different realm), so deepStrictEqual would fail on the
  // mismatched prototype even though the structure is identical.
  assert.equal(calls[0][1].extra.endpoint, undefined);
  assert.equal(calls[0][1].extra.status, 500);
});

test("reportError preserves a bounded websocket trace id for cross-service correlation", () => {
  const { reportError } = loadSentry();
  const calls = [];
  const client = {
    captureException: (...args) => calls.push(args),
  };

  reportError(
    new Error("unauthorized bearer secret"),
    {
      operation: "chatConnect",
      kind: "unauthorized",
      failureKind: "connect_error",
      traceId: "ws-123e4567-e89b-42d3-a456-426614174000",
      endpointPath: "/chat-ws",
      token: "must-not-leave-device",
    },
    client,
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].extra.traceId, "ws-123e4567-e89b-42d3-a456-426614174000");
  assert.equal(calls[0][1].tags.traceId, "ws-123e4567-e89b-42d3-a456-426614174000");
  assert.equal(calls[0][1].extra.endpointPath, "/chat-ws");
  assert.equal(calls[0][1].extra.token, undefined);
});

test("reportError drops caller-controlled values that are not websocket trace ids", () => {
  const { reportError } = loadSentry();
  const calls = [];

  reportError(
    new Error("failed"),
    {
      operation: "chatConnect",
      traceId: "Bearer attacker-controlled-secret",
    },
    { captureException: (...args) => calls.push(args) },
  );

  assert.equal(calls[0][1].extra.traceId, undefined);
  assert.equal(calls[0][1].tags.traceId, undefined);
});

test("reportError drops websocket-shaped account and phone identifiers", () => {
  const { reportError } = loadSentry();

  for (const traceId of ["ws-john-smith-account", "ws-15551234567"]) {
    const calls = [];
    reportError(
      new Error("failed"),
      { operation: "chatConnect", traceId },
      { captureException: (...args) => calls.push(args) },
    );
    assert.equal(calls[0][1].extra.traceId, undefined);
    assert.equal(calls[0][1].tags.traceId, undefined);
  }
});

test("reportError promotes API context to tags and fingerprint", () => {
  const { reportError } = loadSentry();
  const calls = [];
  const client = { captureException: (e, ctx) => calls.push([e, ctx]) };

  reportError(new Error("Database error"), {
    endpointPath: "/note/:id/exports",
    queryKeys: ["ownerId"],
    caption: "private note blue pineapple",
    method: "POST",
    status: 500,
    apiCode: 10001,
    failureKind: "api-code",
  }, client);

  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].tags.endpointPath, "/note/:id/exports");
  assert.equal(calls[0][1].tags.method, "POST");
  assert.equal(calls[0][1].tags.status, "500");
  assert.equal(calls[0][1].tags.apiCode, "10001");
  assert.equal(calls[0][1].tags.failureKind, "api-code");
  assert.equal(calls[0][1].fingerprint.join("|"), [
    "api",
    "POST",
    "/note/:id/exports",
    "500",
    "10001",
    "api-code",
  ].join("|"));
  assert.equal(calls[0][1].tags.queryKeys, undefined);
  assert.equal(calls[0][1].extra.queryKeys, undefined);
  assert.equal(calls[0][1].extra.caption, undefined);
  assert.doesNotMatch(JSON.stringify(calls), /blue pineapple|ownerId/);
});

test("reportError preserves bounded request metadata without changing grouping", () => {
  const { initSentry, reportError } = loadSentry();
  const initCalls = [];
  initSentry({ client: { init: (o) => initCalls.push(o), wrap: (c) => c }, dsn: "https://a@o/1" });
  const captures = [];
  reportError(new Error("failed"), {
    endpointPath: "/notes/:id", method: "GET", status: 503,
    requestId: "123e4567-e89b-42d3-a456-426614174000", durationMs: 12.5,
  }, { captureException: (error, context) => captures.push(context) });
  assert.equal(captures[0].extra.requestId, "123e4567-e89b-42d3-a456-426614174000");
  assert.equal(captures[0].extra.durationMs, 12.5);
  assert.equal(captures[0].tags.requestId, "123e4567-e89b-42d3-a456-426614174000");
  assert.doesNotMatch(captures[0].fingerprint.join("|"), /123e4567|12\.5/);

  const finalEvent = initCalls[0].beforeSend({ tags: captures[0].tags, extra: captures[0].extra });
  assert.equal(finalEvent.tags.requestId, "123e4567-e89b-42d3-a456-426614174000");
  assert.equal(finalEvent.extra.durationMs, 12.5);
});

test("request metadata rejects malformed UUIDs and invalid durations", () => {
  const { reportError } = loadSentry();
  const captures = [];
  reportError(new Error("failed"), { requestId: "not-a-uuid", durationMs: -1 }, {
    captureException: (_error, context) => captures.push(context),
  });
  assert.equal(captures[0], undefined);
});

test("reportError is a no-op by default when Sentry was not initialized", () => {
  const calls = [];
  const { reportError } = load("src/observability/sentry.ts", {
    "@sentry/react-native": {
      init() {},
      wrap: (c) => c,
      captureException: (...args) => calls.push(args),
    },
    "expo-constants": { expoConfig: { extra: {} } },
  });

  reportError(new Error("boom"), { status: 500 });

  assert.equal(calls.length, 0);
});

test("reportError never throws if the Sentry client fails", () => {
  const { initSentry, reportError } = loadSentry();
  initSentry({ dsn: "https://a@o/1", client: { init() {}, wrap: (c) => c } });

  assert.doesNotThrow(() =>
    reportError(new Error("boom"), { status: 500 }, {
      captureException: () => {
        throw new Error("sentry unavailable");
      },
    }),
  );
});

test("reportError captures a generic error copy without custom data or user content", () => {
  const { initSentry, reportError } = loadSentry();
  initSentry({ dsn: "https://a@o/1", client: { init() {}, wrap: (c) => c } });

  const calls = [];
  const err = new Error("private caption blue pineapple https://store/obj?X-Amz-Signature=secret");
  err.data = { token: "secret-token" };

  reportError(err, { operation: "upload" }, {
    captureException: (e, ctx) => calls.push([e, ctx]),
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0].name, "Error");
  assert.equal(calls[0][0].message, "upload error failure");
  assert.equal(calls[0][0].data, undefined);
  assert.doesNotMatch(
    JSON.stringify(calls),
    /blue pineapple|secret-token|X-Amz-Signature|store\/obj/,
  );
});

test("reportError omits extra when no context is given", () => {
  const { initSentry, reportError } = loadSentry();
  initSentry({ dsn: "https://a@o/1", client: { init() {}, wrap: (c) => c } });
  const calls = [];
  const client = { captureException: (e, ctx) => calls.push([e, ctx]) };

  reportError(new Error("x"), undefined, client);

  assert.equal(calls[0][1], undefined);
});

test("shouldReportHttpFailure reports network(0)/5xx, skips 4xx", () => {
  const { shouldReportHttpFailure } = loadSentry();
  for (const s of [0, 500, 502, 503]) {
    assert.equal(shouldReportHttpFailure(s), true, `status ${s} should report`);
  }
  for (const s of [400, 401, 403, 404, 409, 429]) {
    assert.equal(shouldReportHttpFailure(s), false, `status ${s} should skip`);
  }
  assert.equal(shouldReportHttpFailure(undefined), true);
});

test("production sampling collects a small share of traces", () => {
  // 采样率 0 = 移动端零性能数据。后端有 Prometheus 覆盖接口延迟,但那是服务端
  // 视角:弱网、TLS、客户端渲染、本地 SQLite 写入全都看不到 —— 对 IM 产品来说
  // 「消息发送慢」到底慢在哪一段因此无法回答。小采样足够看趋势,又不吃爆配额。
  const { initSentry } = loadSentry();
  const calls = [];
  initSentry({
    client: { init: (o) => calls.push(o), wrap: (c) => c },
    dsn: "https://a@o/1",
    environment: "production",
  });
  assert.ok(calls[0].tracesSampleRate > 0, "production must sample some traces");
  assert.ok(calls[0].tracesSampleRate <= 0.1, "keep the quota bounded");
});

test("transaction names keep static route shape but drop anything id-like", () => {
  const { sanitizeTransactionName } = loadSentry();

  // 真实存在于 app/ 的静态段保留 —— 这是这次放宽的全部目的:issue 列表能按
  // 屏幕区分。这里刻意用真实路由段而不是杜撰的路径,否则测的就不是真行为。
  assert.equal(sanitizeTransactionName("/settings"), "/settings");
  assert.equal(sanitizeTransactionName("/app-settings"), "/app-settings");
  assert.equal(
    sanitizeTransactionName("/(tabs)/discover/filter"),
    "/(tabs)/discover/filter",
  );

  // Expo Router 的参数占位本身不含用户数据,归一化后保留。
  assert.equal(
    sanitizeTransactionName("/(tabs)/messages/circle/[id]"),
    "/(tabs)/messages/circle/[param]",
  );

  // 不在路由表里的段一律当标识符 —— 含数字的、uuid、以及纯字母的 id
  // （后端 id 是不透明的,靠字符类猜必然漏）。
  assert.equal(sanitizeTransactionName("/(tabs)/discover/circle/person-1"), "/(tabs)/discover/circle/:id");
  assert.equal(
    sanitizeTransactionName("/(tabs)/discover/circle/9f1c4e2a-0b77-4c31-9a3e-000000000001"),
    "/(tabs)/discover/circle/:id",
  );
  assert.equal(sanitizeTransactionName("/(tabs)/discover/circle/12345"), "/(tabs)/discover/circle/:id");

  // 形状完全不像路由的,整体退回原来的全遮蔽行为。
  assert.equal(
    sanitizeTransactionName("private route with spaces"),
    "[REDACTED_TRANSACTION]",
  );
  assert.equal(sanitizeTransactionName(""), "[REDACTED_TRANSACTION]");
  assert.equal(sanitizeTransactionName(undefined), "[REDACTED_TRANSACTION]");
});

test("transaction sanitizing never leaks emails, tokens or query strings", () => {
  const { sanitizeTransactionName } = loadSentry();
  for (const hostile of [
    "/u/alice@example.com",
    "/note?token=eyJhbGciOi.aaa.bbb",
    "/x/Bearer abcdef",
    "https://api.example.com/v1/users/42?X-Amz-Signature=deadbeef",
  ]) {
    const out = sanitizeTransactionName(hostile);
    assert.doesNotMatch(out, /@|\?|Bearer|eyJ|Signature/, `leaked from ${hostile}`);
  }
});

test("beforeSendTransaction applies the route-shape rule to the event", () => {
  const { initSentry } = loadSentry();
  const calls = [];
  initSentry({
    client: { init: (o) => calls.push(o), wrap: (c) => c },
    dsn: "https://a@o/1",
  });

  const kept = calls[0].beforeSendTransaction({
    type: "transaction",
    event_id: "e1",
    transaction: "/(tabs)/discover/filter",
    start_timestamp: 1,
    timestamp: 2,
  });
  assert.equal(kept.transaction, "/(tabs)/discover/filter");

  const scrubbed = calls[0].beforeSendTransaction({
    type: "transaction",
    event_id: "e2",
    transaction: "/(tabs)/discover/circle/privatecircle",
    start_timestamp: 1,
    timestamp: 2,
  });
  assert.equal(scrubbed.transaction, "/(tabs)/discover/circle/:id");
});

test("navigation transactions are named after the Expo Router route template", () => {
  // reactNavigationIntegration 用嵌套导航器的路由名拼全路径（__root/(tabs)/...），
  // 不以 / 开头；不归一化的话每条导航 transaction 都会被整体遮成 [REDACTED_TRANSACTION]。
  const { initSentry } = loadSentry();
  const calls = [];
  initSentry({ client: { init: (o) => calls.push(o), wrap: (c) => c }, dsn: "https://a@o/1" });
  const name = (transaction, source = "component") =>
    calls[0].beforeSendTransaction({
      type: "transaction",
      transaction,
      transaction_info: { source },
      start_timestamp: 1,
      timestamp: 2,
    }).transaction;

  assert.equal(name("__root/(tabs)/messages/index"), "/(tabs)/messages");
  assert.equal(name("__root/(tabs)/messages/user/[id]"), "/(tabs)/messages/user/[param]");
  assert.equal(name("__root/index"), "/");
  // 路由名本来就不含参数值；万一出现不在路由表里的段，照旧当标识符处理。
  assert.equal(name("__root/(tabs)/messages/user/alice"), "/(tabs)/messages/user/:id");
  assert.equal(name("__root/(tabs)/private route"), "[REDACTED_TRANSACTION]");
  // 非导航来源不享受这条归一化。
  assert.equal(name("__root/(tabs)/messages/index", "custom"), "[REDACTED_TRANSACTION]");
});

test("custom chat spans keep their fixed names; other custom names stay redacted", () => {
  const { initSentry } = loadSentry();
  const calls = [];
  initSentry({ client: { init: (o) => calls.push(o), wrap: (c) => c }, dsn: "https://a@o/1" });
  const name = (transaction) =>
    calls[0].beforeSendTransaction({
      type: "transaction",
      transaction,
      transaction_info: { source: "custom" },
      start_timestamp: 1,
      timestamp: 2,
    }).transaction;

  assert.equal(name("chat.message.send"), "chat.message.send");
  assert.equal(name("chat.socket.connect"), "chat.socket.connect");
  assert.equal(name("chat.message.send blue pineapple"), "[REDACTED_TRANSACTION]");
});

test("already-normalized transaction names survive a second sanitizing pass", () => {
  // core 对根 span 跑过 beforeSendSpan 之后，beforeSendTransaction 会再处理一遍同一个名字。
  const { initSentry } = loadSentry();
  const calls = [];
  initSentry({ client: { init: (o) => calls.push(o), wrap: (c) => c }, dsn: "https://a@o/1" });
  for (const [transaction, source] of [
    ["/(tabs)/messages", "component"],
    ["/(tabs)/messages/user/[param]", "component"],
    ["/(tabs)/messages/user/:id", "component"],
    ["/", "component"],
    ["/(tabs)/discover/circle/:id", "url"],
    ["chat.socket.connect", "custom"],
  ]) {
    const event = calls[0].beforeSendTransaction({
      type: "transaction",
      transaction,
      transaction_info: { source },
      start_timestamp: 1,
      timestamp: 2,
    });
    assert.equal(event.transaction, transaction);
  }
});

// 走真的 @sentry/core 处理链。core 先对根 span 跑 beforeSendSpan，再把结果 merge 回
// 事件（undefined 也会覆盖），最后才跑 beforeSendTransaction —— 根 span 上没带回的
// description / measurements 会把 transaction 名和冷启动指标清掉。只直接调
// beforeSendTransaction 的测试看不到这一层。
async function sendThroughSentryCore(event) {
  const core = require("@sentry/core");
  const { initSentry } = loadSentry();
  const calls = [];
  initSentry({ client: { init: (o) => calls.push(o), wrap: (c) => c }, dsn: "https://a@o/1" });
  const { beforeSend, beforeSendTransaction, beforeSendSpan } = calls[0];
  const sent = [];
  class TestClient extends core.Client {
    eventFromException() {
      return Promise.resolve({});
    }
    eventFromMessage() {
      return Promise.resolve({});
    }
  }
  const client = new TestClient({
    dsn: "https://public@example.invalid/1",
    integrations: [],
    stackParser: () => [],
    transport: () => ({
      send: (envelope) => {
        sent.push(envelope);
        return Promise.resolve({});
      },
      flush: () => Promise.resolve(true),
    }),
    beforeSend,
    beforeSendTransaction,
    beforeSendSpan,
  });
  client.init();
  client.captureEvent(event);
  await client.flush(1000);
  assert.equal(sent.length, 1, "the transaction should reach the transport");
  const [, items] = sent[0];
  return items[0][1];
}

test("navigation names and cold start survive the real Sentry core pipeline", async () => {
  const sent = await sendThroughSentryCore({
    type: "transaction",
    transaction: "__root/(tabs)/messages/user/[id]",
    transaction_info: { source: "component" },
    start_timestamp: 1,
    timestamp: 2,
    contexts: {
      trace: {
        trace_id: "a".repeat(32),
        span_id: "b".repeat(16),
        op: "navigation",
        data: { "sentry.source": "component", "route.key": "private-route-key" },
      },
    },
    measurements: {
      app_start_cold: { value: 1234, unit: "millisecond" },
      private_metric: { value: 1, unit: "none" },
    },
    spans: [],
  });

  assert.equal(sent.transaction, "/(tabs)/messages/user/[param]");
  assert.deepEqual(JSON.parse(JSON.stringify(sent.measurements)), {
    app_start_cold: { value: 1234, unit: "millisecond" },
  });
  assert.doesNotMatch(JSON.stringify(sent), /private-route-key|private_metric/);
});

test("custom chat span names survive the real Sentry core pipeline", async () => {
  const sent = await sendThroughSentryCore({
    type: "transaction",
    transaction: "chat.message.send",
    transaction_info: { source: "custom" },
    start_timestamp: 1,
    timestamp: 2,
    contexts: {
      trace: {
        trace_id: "a".repeat(32),
        span_id: "b".repeat(16),
        op: "chat.send",
        status: "deadline_exceeded",
        data: { "sentry.source": "custom" },
      },
    },
    spans: [],
  });

  assert.equal(sent.transaction, "chat.message.send");
  assert.equal(sent.contexts.trace.op, "chat.send");
  assert.equal(sent.contexts.trace.status, "deadline_exceeded");
});

test("trace headers are never attached to outgoing requests", () => {
  // 原生端默认 tracePropagationTargets=[/.*/]：每个 XHR 都带 sentry-trace / baggage，
  // 连发往第三方存储的预签名 PUT 也带上 release 和 public key。后端不消费这两个头，
  // 请求串联靠 X-Request-Id。空数组（而不是 undefined）才能盖掉 SDK 默认值。
  const { initSentry } = loadSentry();
  const calls = [];
  initSentry({ client: { init: (o) => calls.push(o), wrap: (c) => c }, dsn: "https://a@o/1" });
  assert.equal(Array.isArray(calls[0].tracePropagationTargets), true);
  assert.equal(calls[0].tracePropagationTargets.length, 0);
});

test("initSentry wires navigation tracing so cold start and XHR spans have a root", () => {
  const { initSentry, registerSentryNavigationContainer } = loadSentry();
  const created = [];
  const registered = [];
  const integration = {
    name: "ReactNavigation",
    registerNavigationContainer: (ref) => registered.push(ref),
  };
  const calls = [];
  initSentry({
    client: {
      init: (o) => calls.push(o),
      wrap: (c) => c,
      reactNavigationIntegration: (options) => {
        created.push(options);
        return integration;
      },
    },
    dsn: "https://a@o/1",
  });

  assert.equal(created.length, 1);
  assert.equal(created[0].useFullPathsForNavigationRoutes, true);
  assert.equal(calls[0].integrations.length, 1);
  assert.equal(calls[0].integrations[0], integration);

  const ref = { current: { addListener() {} } };
  registerSentryNavigationContainer(ref);
  assert.equal(registered.length, 1);
  assert.equal(registered[0], ref);
});

test("navigation registration is inert without Sentry and never throws", () => {
  const { initSentry, registerSentryNavigationContainer } = loadSentry();
  assert.doesNotThrow(() => registerSentryNavigationContainer({ current: null }));

  initSentry({
    client: {
      init() {},
      wrap: (c) => c,
      reactNavigationIntegration: () => ({
        registerNavigationContainer: () => {
          throw new Error("navigation container unavailable");
        },
      }),
    },
    dsn: "https://a@o/1",
  });
  assert.doesNotThrow(() => registerSentryNavigationContainer({ current: {} }));
});

test("root layout registers the Expo Router navigation container with Sentry", () => {
  const layout = fs.readFileSync(path.join(process.cwd(), "app/_layout.tsx"), "utf8");
  assert.match(layout, /\buseNavigationContainerRef\b[^;]*from 'expo-router'/s);
  assert.match(layout, /registerSentryNavigationContainer\(navigationRef\)/);
});

test("alphabetic dynamic ids are redacted, not mistaken for static routes", () => {
  // review #161：MyCirclesScreen 会 router.push(`/(tabs)/discover/circle/${id}`)，
  // 而后端 id 是不透明的 —— 靠「id 一定含数字」来判定就是漏点本身。
  const { sanitizeTransactionName } = loadSentry();
  assert.equal(
    sanitizeTransactionName("/(tabs)/discover/circle/privatecircle"),
    "/(tabs)/discover/circle/:id",
  );
  assert.equal(sanitizeTransactionName("/circle/privatecircle"), "/circle/:id");
});

test("storage provider codes reach Sentry as a tag and split upload issues", () => {
  // upload.ts 早就把白名单内的存储错误码放进 context，但 sentry.ts 的白名单没有
  // storageCode，一直在这里被丢掉：AccessDenied（签名 bug）和 SlowDown（限流）
  // 混成同一个 issue。
  const { initSentry, reportError } = loadSentry();
  const initCalls = [];
  initSentry({ client: { init: (o) => initCalls.push(o), wrap: (c) => c }, dsn: "https://a@o/1" });
  const captures = [];
  const capture = { captureException: (_e, ctx) => captures.push(ctx) };

  reportError(new Error("x"), { operation: "upload", kind: "presigned-put", status: 403, storageCode: "AccessDenied" }, capture);
  reportError(new Error("x"), { operation: "upload", kind: "presigned-put", status: 503, storageCode: "SlowDown" }, capture);
  reportError(new Error("x"), { operation: "upload", kind: "presigned-put", storageCode: "Access Denied <Key>private</Key>" }, capture);

  assert.equal(captures[0].extra.storageCode, "AccessDenied");
  assert.equal(captures[0].tags.storageCode, "AccessDenied");
  assert.notEqual(captures[0].fingerprint.join("|"), captures[1].fingerprint.join("|"));
  assert.equal(captures[2].extra.storageCode, undefined);
  assert.equal(captures[2].tags.storageCode, undefined);
  assert.doesNotMatch(JSON.stringify(captures[2]), /private/);

  const finalEvent = initCalls[0].beforeSend({ tags: captures[0].tags, extra: captures[0].extra });
  assert.equal(finalEvent.tags.storageCode, "AccessDenied");
  assert.equal(finalEvent.extra.storageCode, "AccessDenied");
});

test("chat send error codes split into separate issues", () => {
  const { reportError } = loadSentry();
  const captures = [];
  const capture = { captureException: (_e, ctx) => captures.push(ctx) };

  reportError(new Error("x"), { operation: "chatSend", kind: "text", code: "CHAT_ACK_TIMEOUT" }, capture);
  reportError(new Error("x"), { operation: "chatSend", kind: "text", code: "CHAT_INVALID_PAYLOAD" }, capture);
  reportError(new Error("x"), { operation: "chatSend", kind: "text", code: "free text with spaces" }, capture);

  assert.equal(captures[0].fingerprint.join("|"), "chatSend|text|error|CHAT_ACK_TIMEOUT");
  assert.equal(captures[1].fingerprint.join("|"), "chatSend|text|error|CHAT_INVALID_PAYLOAD");
  assert.equal(captures[0].tags.code, "CHAT_ACK_TIMEOUT");
  // 形状不对的 code 不进 tag、不进 fingerprint，也不进 extra。
  assert.equal(captures[2].fingerprint.join("|"), "chatSend|text|error");
  assert.equal(captures[2].tags.code, undefined);
  assert.equal(captures[2].extra.code, undefined);
});

test("Sentry and dev-log redaction share one sensitive field list", () => {
  // 两份清单分叉过两次：redact 有 revocationsecret / qrtoken / pollkey / newpassword，
  // sentry 漏了；sentry 有 email / phone，redact 漏了。现在只有 utils/redact.ts 一份。
  const sentrySource = fs.readFileSync(path.join(process.cwd(), "src/observability/sentry.ts"), "utf8");
  assert.doesNotMatch(sentrySource, /SENSITIVE_CONTEXT_KEYS|const SENSITIVE_[A-Z_]*KEYS\s*=\s*new Set/);
  assert.match(sentrySource, /import \{[^}]*\bisSensitiveFieldKey\b[^}]*\} from '@\/utils\/redact'/);

  const breadcrumbs = [{
    event: "auth.reset.failed",
    details: {
      email: "person@example.test",
      phoneNumber: "+1 415 555 1234",
      pollKey: "poll-secret",
      qrToken: "qr-secret",
      newPassword: "new-secret",
      revocationSecret: "revoke-secret",
      stage: "submit",
    },
  }];
  const sentry = load("src/observability/sentry.ts", {
    "@sentry/react-native": { init() {}, wrap: (c) => c, captureException() {} },
    "expo-constants": { expoConfig: { extra: {} } },
    "@/utils/client-diagnostics": { readDiagnosticBreadcrumbs: () => breadcrumbs },
  });
  const captures = [];
  sentry.reportError(new Error("x"), { operation: "auth", kind: "reset" }, {
    captureException: (_e, ctx) => captures.push(ctx),
  });
  const details = captures[0].extra.clientDiagnostics[0].details;
  for (const key of ["email", "phoneNumber", "pollKey", "qrToken", "newPassword", "revocationSecret"]) {
    assert.equal(details[key], "[REDACTED]", key);
  }
  assert.equal(details.stage, "submit");
});

// Hermes 上真正生效的未处理 rejection tracker 是 SDK 自己挂在 HermesInternal 上的
// （reactNativeErrorHandlersIntegration）；silence-dom-bridge-rejection 启用的 promise
// 包 tracker 只管 JSC，在 Hermes 上从不触发。所以 DOM 桥接过滤和按签名限流必须放在
// 所有引擎都会经过的 beforeSend 里，按 mechanism.type 只作用于未处理 rejection。
function unhandledRejectionEvent(error) {
  return [
    {
      exception: {
        values: [{
          type: error instanceof Error ? error.name : "Error",
          value: error instanceof Error ? error.message : String(error),
          mechanism: { type: "onunhandledrejection", handled: true },
        }],
      },
    },
    { originalException: error },
  ];
}

test("unhandled rejections are deduped per signature on every engine", () => {
  const { initSentry } = loadSentry();
  const calls = [];
  initSentry({ client: { init: (o) => calls.push(o), wrap: (c) => c }, dsn: "https://a@o/1" });
  const beforeSend = calls[0].beforeSend;

  assert.notEqual(beforeSend(...unhandledRejectionEvent(new TypeError("x is not a function"))), null);
  assert.equal(beforeSend(...unhandledRejectionEvent(new TypeError("x is not a function"))), null);
  assert.notEqual(beforeSend(...unhandledRejectionEvent(new RangeError("different failure"))), null);
});

test("the benign DOM bridge teardown rejection never reaches Sentry", () => {
  const { initSentry } = loadSentry();
  const calls = [];
  initSentry({ client: { init: (o) => calls.push(o), wrap: (c) => c }, dsn: "https://a@o/1" });
  const dropped = calls[0].beforeSend(
    ...unhandledRejectionEvent(new Error("DomWebView: injectJavaScript on a destroyed view")),
  );
  assert.equal(dropped, null);
});

test("distinct unhandled rejection signatures are capped per process", () => {
  const { initSentry } = loadSentry();
  const calls = [];
  initSentry({ client: { init: (o) => calls.push(o), wrap: (c) => c }, dsn: "https://a@o/1" });
  const sent = [];
  for (let i = 0; i < 100; i += 1) {
    const event = calls[0].beforeSend(...unhandledRejectionEvent(new Error(`flood ${i}`)));
    if (event) sent.push(event);
  }
  assert.ok(sent.length >= 10 && sent.length < 100, `expected a bounded number, got ${sent.length}`);
});

test("the rejection budget never throttles ordinary error events", () => {
  const { initSentry } = loadSentry();
  const calls = [];
  initSentry({ client: { init: (o) => calls.push(o), wrap: (c) => c }, dsn: "https://a@o/1" });
  for (let i = 0; i < 30; i += 1) {
    const event = calls[0].beforeSend(
      { exception: { values: [{ type: "Error", value: "same", mechanism: { type: "generic", handled: true } }] } },
      { originalException: new Error("same") },
    );
    assert.notEqual(event, null);
  }
});

test("session tracking is explicitly on so web reports release health too", () => {
  // @sentry/react-native 只有 enableAutoSessionTracking 为真时才在 web 挂
  // browserSessionIntegration；原生 SDK 默认开，web 不开就一条会话都没有。
  const { initSentry } = loadSentry();
  const calls = [];
  initSentry({ client: { init: (o) => calls.push(o), wrap: (c) => c }, dsn: "https://a@o/1" });
  assert.equal(calls[0].enableAutoSessionTracking, true);
});

test("web unhandled rejections (browser global handler mechanism) pass the same gate", () => {
  // web 上挂的是 browserGlobalHandlersIntegration，mechanism.type 带命名空间前缀。
  const { initSentry } = loadSentry();
  const calls = [];
  initSentry({ client: { init: (o) => calls.push(o), wrap: (c) => c }, dsn: "https://a@o/1" });
  const webEvent = (error) => [
    { exception: { values: [{ type: "Error", value: error.message, mechanism: { type: "auto.browser.global_handlers.onunhandledrejection", handled: false } }] } },
    { originalException: error },
  ];
  assert.equal(calls[0].beforeSend(...webEvent(new Error("DomWebView: injectJavaScript after unmount"))), null);
  assert.notEqual(calls[0].beforeSend(...webEvent(new Error("web flake"))), null);
  assert.equal(calls[0].beforeSend(...webEvent(new Error("web flake"))), null);
});
