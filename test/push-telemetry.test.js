const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadTsModule } = require("./helpers/load-ts-module");

// 推送送达 / 打开的粗粒度遥测：只记通道（jpush / expo）和由推送类型归出的大类，
// 不带标题、正文、会话或用户标识。同一条推送（按 identifier）只记一次。

function harness() {
  const metrics = [];
  const telemetry = loadTsModule("src/features/notifications/utils/push-telemetry.ts");
  const recorder = telemetry.createPushTelemetry({
    recordMetric: (name, value, attributes) => metrics.push({ name, value, attributes: { ...attributes } }),
  });
  return { ...telemetry, recorder, metrics };
}

test("push types collapse into a handful of coarse categories", () => {
  const { pushCategory } = harness();
  assert.equal(pushCategory({ type: "MESSAGE_RECEIVED" }), "chat");
  assert.equal(pushCategory({ notificationType: "member_mention" }), "chat");
  assert.equal(pushCategory({ type: "FRIEND_REQUEST_RECEIVED" }), "social");
  assert.equal(pushCategory({ type: "PROFILE_LIKE" }), "social");
  assert.equal(pushCategory({ type: "CIRCLE_INVITATION_RECEIVED" }), "circle");
  assert.equal(pushCategory({ type: "GROUP_ADMISSION" }), "circle");
  assert.equal(pushCategory({ type: "SYSTEM" }), "system");
  assert.equal(pushCategory({ type: "SOMETHING_NEW" }), "other");
  assert.equal(pushCategory({}), "other");
  assert.equal(pushCategory(null), "other");
});

test("received and opened pushes are counted once per notification, without content", () => {
  const h = harness();
  const data = {
    type: "MESSAGE_RECEIVED",
    title: "Alice",
    body: "private blue pineapple",
    conversationID: "c-private",
    toUserId: "u-1",
  };
  h.recorder.received("jpush", "msg-1", data);
  h.recorder.received("jpush", "msg-1", data);
  h.recorder.opened("expo", "msg-1", data);
  h.recorder.opened("expo", "msg-1", data);

  assert.deepEqual(h.metrics, [
    { name: "push.received", value: 1, attributes: { provider: "jpush", category: "chat" } },
    { name: "push.opened", value: 1, attributes: { provider: "expo", category: "chat" } },
  ]);
  assert.doesNotMatch(JSON.stringify(h.metrics), /Alice|pineapple|c-private|u-1|msg-1/);
});

test("the dedupe memory is bounded", () => {
  const h = harness();
  for (let i = 0; i < 500; i += 1) h.recorder.opened("jpush", `id-${i}`, {});
  assert.equal(h.metrics.length, 500);
  // 很早以前的 id 已被挤出去：再来一次会重新计数（有界内存的代价，可接受）。
  h.recorder.opened("jpush", "id-0", {});
  assert.equal(h.metrics.length, 501);
  h.recorder.opened("jpush", "id-499", {});
  assert.equal(h.metrics.length, 501);
});

test("the push route handler records arrivals and taps from both providers", () => {
  const handler = fs.readFileSync(
    path.join(process.cwd(), "src/features/notifications/components/PushNotificationRouteHandler.tsx"),
    "utf8",
  );
  assert.match(handler, /pushTelemetry\.received\('jpush'/);
  assert.match(handler, /pushTelemetry\.opened\('jpush'/);
  assert.match(handler, /pushTelemetry\.opened\('expo'/);
  assert.match(handler, /addNotificationReceivedListener\(/);
  assert.match(handler, /pushTelemetry\.received\('expo'/);
});
