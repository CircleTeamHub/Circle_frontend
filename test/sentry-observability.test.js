const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

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
      traceId: "ws-matching-trace-123",
      endpointPath: "/chat-ws",
      token: "must-not-leave-device",
    },
    client,
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].extra.traceId, "ws-matching-trace-123");
  assert.equal(calls[0][1].tags.traceId, "ws-matching-trace-123");
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
    sanitizeTransactionName("/(tabs)/discover/circles"),
    "/(tabs)/discover/circles",
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
    transaction: "/(tabs)/discover/circles",
    start_timestamp: 1,
    timestamp: 2,
  });
  assert.equal(kept.transaction, "/(tabs)/discover/circles");

  const scrubbed = calls[0].beforeSendTransaction({
    type: "transaction",
    event_id: "e2",
    transaction: "/(tabs)/discover/circle/privatecircle",
    start_timestamp: 1,
    timestamp: 2,
  });
  assert.equal(scrubbed.transaction, "/(tabs)/discover/circle/:id");
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
