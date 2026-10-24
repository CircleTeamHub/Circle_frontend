const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadTsModule } = require("./helpers/load-ts-module");

// 通话质量遥测：建连耗时、断开原因、本端连接质量下降与重连次数。只记枚举和数值，
// 不带参与者 identity、房间名、token。异常断开另报一条错误（错误码 = 原因枚举）。

function harness() {
  let clock = 1_000;
  const metrics = [];
  const failures = [];
  const diagnostics = [];
  const { createCallTelemetry, CALL_DISCONNECT_REASON_NAMES } = loadTsModule("src/features/call/call-telemetry.ts");
  const telemetry = createCallTelemetry({
    now: () => clock,
    recordMetric: (name, value, attributes = {}) => metrics.push({ name, value, attributes: { ...attributes } }),
    reportFailure: (operation, kind, error, context) =>
      failures.push({ operation, kind, error, context: { ...context } }),
    logDiagnostic: (event, details) => diagnostics.push({ event, details: { ...details } }),
  });
  return {
    telemetry,
    metrics,
    failures,
    diagnostics,
    CALL_DISCONNECT_REASON_NAMES,
    advance: (ms) => {
      clock += ms;
    },
  };
}

test("connect latency is recorded once, from room creation to the first connect", () => {
  const h = harness();
  h.advance(850);
  h.telemetry.connected();
  h.telemetry.connected();
  assert.deepEqual(h.metrics, [{ name: "call.connect.duration", value: 850, attributes: { outcome: "connected" } }]);
});

test("a connect error before connecting records a failed attempt", () => {
  const h = harness();
  h.advance(3_000);
  h.telemetry.connectFailed();
  h.telemetry.connectFailed();
  assert.deepEqual(h.metrics, [{ name: "call.connect.duration", value: 3_000, attributes: { outcome: "failed" } }]);
});

test("leaving before the room connects records a cancelled attempt", () => {
  const h = harness();
  h.advance(400);
  h.telemetry.dispose();
  assert.deepEqual(h.metrics, [{ name: "call.connect.duration", value: 400, attributes: { outcome: "cancelled" } }]);
});

test("a normal hang-up records the reason and session quality, without an error report", () => {
  const h = harness();
  h.telemetry.connected();
  h.telemetry.qualityChanged("good");
  h.advance(10_000);
  h.telemetry.qualityChanged("poor");
  h.advance(4_000);
  h.telemetry.qualityChanged("lost");
  h.advance(2_000);
  h.telemetry.qualityChanged("excellent");
  h.telemetry.connectionStateChanged("reconnecting");
  h.telemetry.connectionStateChanged("signalReconnecting");
  h.telemetry.connectionStateChanged("connected");
  h.telemetry.disconnected(1); // CLIENT_INITIATED

  const byName = (name) => h.metrics.filter((m) => m.name === name);
  assert.deepEqual(byName("call.disconnect"), [{ name: "call.disconnect", value: 1, attributes: { reason: "CLIENT_INITIATED" } }]);
  assert.deepEqual(byName("call.quality.degraded"), [
    { name: "call.quality.degraded", value: 1, attributes: { quality: "poor" } },
    { name: "call.quality.degraded", value: 1, attributes: { quality: "lost" } },
  ]);
  assert.deepEqual(byName("call.quality.degraded_time"), [
    { name: "call.quality.degraded_time", value: 4, attributes: { quality: "poor" } },
    { name: "call.quality.degraded_time", value: 2, attributes: { quality: "lost" } },
  ]);
  // reconnecting → signalReconnecting 是同一次重连。
  assert.deepEqual(byName("call.reconnects"), [{ name: "call.reconnects", value: 1, attributes: {} }]);
  assert.equal(h.failures.length, 0);
});

test("an abnormal disconnect is reported with the reason enum as its code", () => {
  const h = harness();
  h.telemetry.connected();
  h.telemetry.disconnected(9); // SIGNAL_CLOSE
  h.telemetry.disconnected(9);
  h.telemetry.dispose();

  assert.equal(h.failures.length, 1);
  assert.equal(h.failures[0].operation, "call");
  assert.equal(h.failures[0].kind, "abnormalDisconnect");
  assert.deepEqual(h.failures[0].context, { code: "SIGNAL_CLOSE" });
  assert.equal(h.metrics.filter((m) => m.name === "call.disconnect").length, 1);
});

test("unknown or missing disconnect reasons stay bounded", () => {
  const h = harness();
  h.telemetry.connected();
  h.telemetry.disconnected(999);
  assert.deepEqual(h.metrics.find((m) => m.name === "call.disconnect").attributes, { reason: "UNRECOGNIZED" });
  assert.equal(h.failures[0].context.code, "UNRECOGNIZED");

  const quiet = harness();
  quiet.telemetry.connected();
  quiet.telemetry.disconnected(undefined);
  assert.deepEqual(quiet.metrics.find((m) => m.name === "call.disconnect").attributes, { reason: "UNSPECIFIED" });
  assert.equal(quiet.failures.length, 0);
});

test("quality breadcrumbs are bounded per call and carry only the quality enum", () => {
  const h = harness();
  h.telemetry.connected();
  for (let i = 0; i < 20; i += 1) {
    h.telemetry.qualityChanged("poor");
    h.telemetry.qualityChanged("good");
  }
  const degraded = h.diagnostics.filter((d) => d.event === "call.quality.degraded");
  assert.ok(degraded.length <= 5, `expected at most 5 breadcrumbs, got ${degraded.length}`);
  assert.deepEqual(degraded[0].details, { reason: "poor" });
  h.telemetry.qualityChanged("private identity text");
  assert.doesNotMatch(JSON.stringify([h.metrics, h.diagnostics]), /private identity/);
});

test("every disconnect reason name is allowed by the metrics table", () => {
  const h = harness();
  const { TELEMETRY_METRICS } = loadTsModule("src/observability/metrics.ts", {
    requireShim: (request) => (request === "@sentry/react-native" ? {} : require(request)),
  });
  const allowed = TELEMETRY_METRICS["call.disconnect"].attributes.reason;
  for (const name of h.CALL_DISCONNECT_REASON_NAMES) {
    assert.ok(allowed.includes(name), `${name} missing from the metrics table`);
  }
});

test("the call screen feeds connect, disconnect, quality and reconnect events into telemetry", () => {
  const screen = fs.readFileSync(path.join(process.cwd(), "src/features/call/screens/GroupCallScreen.tsx"), "utf8");
  assert.match(screen, /onConnected=\{callTelemetry\.connected\}/);
  assert.match(screen, /onDisconnected=\{callTelemetry\.disconnected\}/);
  assert.match(screen, /callTelemetry\.connectFailed\(\)/);
  assert.match(screen, /useCallRoomTelemetry\(/);
});

test("connect latency starts when the room mounts, not when the screen loads the SDK", () => {
  const h = harness();
  h.advance(2_000); // 屏幕在等 LiveKit 模块加载
  h.telemetry.roomMounted();
  h.advance(600);
  h.telemetry.connected();
  h.telemetry.roomMounted(); // 已连上之后不再重置
  assert.deepEqual(h.metrics, [{ name: "call.connect.duration", value: 600, attributes: { outcome: "connected" } }]);
});
