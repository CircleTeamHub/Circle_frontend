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

test("a join failure settles the connect phase as failed without a second error report", () => {
  // livekit 的 Room.connect 失败时先以 JOIN_FAILURE 触发 Disconnected 再 reject，
  // onError 那边已经报了 livekit/roomConnection：这里只记指标，不再报一条。
  const h = harness();
  h.telemetry.roomMounted();
  h.advance(3_000);
  h.telemetry.disconnected(7); // JOIN_FAILURE
  assert.deepEqual(h.metrics, [
    { name: "call.connect.duration", value: 3_000, attributes: { outcome: "failed" } },
  ]);
  assert.equal(h.failures.length, 0);
});

test("leaving before the room connects records a cancelled attempt", () => {
  const h = harness();
  h.telemetry.roomMounted();
  h.advance(400);
  h.telemetry.dispose();
  assert.deepEqual(h.metrics, [{ name: "call.connect.duration", value: 400, attributes: { outcome: "cancelled" } }]);
});

test("a room that never mounted records no connect sample", () => {
  // 通话已结束页、「LiveKit 不可用」页、模块还没加载完就返回：都没开始建连。
  const h = harness();
  h.advance(5_000);
  h.telemetry.dispose();
  assert.deepEqual(h.metrics, []);
});

test("unmounting a connected room ends the session even when Disconnected never arrives", () => {
  // 挂断 / 对端结束：activeCall 先被清空，LiveKitRoom 卸载时它的 Disconnected 监听已经
  // 摘掉，room.disconnect() 之后才发出的事件没人收。不在卸载时收尾，正常断开就数不到，
  // 卸载那一刻还开着的 poor 区间也会一直累计下去。
  const h = harness();
  h.telemetry.roomMounted();
  h.telemetry.connected();
  h.telemetry.qualityChanged("poor");
  h.advance(3_000);
  h.telemetry.roomUnmounted();
  h.advance(60_000);
  h.telemetry.dispose();
  const byName = (name) => h.metrics.filter((m) => m.name === name);
  assert.deepEqual(byName("call.disconnect"), [{ name: "call.disconnect", value: 1, attributes: { reason: "UNSPECIFIED" } }]);
  assert.deepEqual(byName("call.quality.degraded_time"), [
    { name: "call.quality.degraded_time", value: 3, attributes: { quality: "poor" } },
  ]);
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
  // 质量下降次数在通话结束时按档汇总发一次，不是每抖一下发一条。
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

test("a flapping link sends one aggregated quality metric, and bounded breadcrumbs", () => {
  const h = harness();
  h.telemetry.connected();
  for (let i = 0; i < 20; i += 1) {
    h.telemetry.qualityChanged("poor");
    h.telemetry.qualityChanged("good");
  }
  assert.equal(h.metrics.filter((m) => m.name === "call.quality.degraded").length, 0, "nothing until the call ends");
  h.telemetry.disconnected(1);
  assert.deepEqual(h.metrics.filter((m) => m.name === "call.quality.degraded"), [
    { name: "call.quality.degraded", value: 20, attributes: { quality: "poor" } },
  ]);
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
  assert.match(screen, /useCallRoomTelemetry\(/);
  // 本端挂断在 leaveActiveCall 清空 activeCall（=卸载 LiveKitRoom）之前记 CLIENT_INITIATED。
  assert.match(screen, /callTelemetry\.disconnected\(CLIENT_INITIATED_DISCONNECT\);[\s\S]{0,200}?await leaveActiveCall\(\)/);
  // onError 也会因麦克风/摄像头被拒而触发（房间照样能连上），不能把它记成建连失败。
  assert.doesNotMatch(screen, /connectFailed/);
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
