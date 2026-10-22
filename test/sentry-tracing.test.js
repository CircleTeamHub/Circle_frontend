const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

// 自定义 span 的契约：名字和 op 只来自代码里的固定表，不带任何属性（用户、会话、
// 消息内容都不可能经由这里进 Sentry）；失败状态只收 Sentry 认得的状态枚举（集合外
// 的值会在接收端被丢掉，失败率就算不出来）；SDK 出任何问题都不能反过来影响
// 发消息 / 建连。

function loadTracing(sdk) {
  const filePath = path.join(process.cwd(), "src/observability/tracing.ts");
  const transpiled = ts.transpileModule(fs.readFileSync(filePath, "utf8"), {
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
    require: (name) => {
      if (name === "@sentry/react-native") return sdk;
      throw new Error(`unexpected require: ${name}`);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

function recordingSdk() {
  const started = [];
  const sdk = {
    startInactiveSpan(options) {
      const span = {
        options,
        statuses: [],
        ends: 0,
        setStatus(status) {
          span.statuses.push({ ...status });
        },
        end() {
          span.ends += 1;
        },
      };
      started.push(span);
      return span;
    },
  };
  return { sdk, started };
}

test("chat spans are root spans with fixed names and no attributes", () => {
  const { sdk, started } = recordingSdk();
  const { startOperationSpan } = loadTracing(sdk);

  startOperationSpan("chatSend");
  startOperationSpan("chatConnect");

  assert.deepEqual(JSON.parse(JSON.stringify(started.map((s) => s.options))), [
    { name: "chat.message.send", op: "chat.send", parentSpan: null },
    { name: "chat.socket.connect", op: "websocket.connect", parentSpan: null },
  ]);
  // parentSpan:null 不能被 JSON 丢掉：它决定 span 不挂到导航 idle span 下面，
  // 否则一次 60 秒的发送会把那条导航 transaction 一直撑开。
  for (const span of started) assert.equal(span.options.parentSpan, null);
});

test("ending a span records ok or a canonical failure status exactly once", () => {
  const { sdk, started } = recordingSdk();
  const { startOperationSpan } = loadTracing(sdk);

  const ok = startOperationSpan("chatSend");
  ok.end();
  ok.end("deadline_exceeded");
  assert.deepEqual(started[0].statuses, [{ code: 1 }]);
  assert.equal(started[0].ends, 1);

  const failed = startOperationSpan("chatConnect");
  failed.end("unauthenticated");
  assert.deepEqual(started[1].statuses, [{ code: 2, message: "unauthenticated" }]);
  assert.equal(started[1].ends, 1);
});

test("anything outside Sentry's status set becomes unknown_error", () => {
  const { sdk, started } = recordingSdk();
  const { startOperationSpan } = loadTracing(sdk);

  startOperationSpan("chatSend").end("Bearer top-secret blue pineapple");
  // 形状正常但不在状态集合里的业务码也一样：接收端会把它丢掉。
  startOperationSpan("chatSend").end("CHAT_SENSITIVE_WORD_BLOCKED");
  assert.deepEqual(started[0].statuses, [{ code: 2, message: "unknown_error" }]);
  assert.deepEqual(started[1].statuses, [{ code: 2, message: "unknown_error" }]);
});

test("unknown operations and SDK failures degrade to a no-op span", () => {
  const throwingSdk = {
    startInactiveSpan() {
      throw new Error("tracing unavailable");
    },
  };
  const { startOperationSpan } = loadTracing(throwingSdk);
  assert.doesNotThrow(() => startOperationSpan("chatSend").end("internal_error"));

  const { sdk, started } = recordingSdk();
  const tracing = loadTracing(sdk);
  assert.doesNotThrow(() => tracing.startOperationSpan("privateCaption").end());
  assert.equal(started.length, 0);

  const brokenSpanSdk = {
    startInactiveSpan: () => ({
      setStatus() {
        throw new Error("span already finished");
      },
      end() {},
    }),
  };
  const broken = loadTracing(brokenSpanSdk);
  assert.doesNotThrow(() => broken.startOperationSpan("chatSend").end());
});

test("a missing SDK tracing API is tolerated (Jest mock, web stubs)", () => {
  const { startOperationSpan } = loadTracing({});
  assert.doesNotThrow(() => startOperationSpan("chatConnect").end());
});

test("the span name allowlist exported to the privacy filter matches the table", () => {
  const { TRACED_SPAN_NAMES } = loadTracing({});
  assert.deepEqual([...TRACED_SPAN_NAMES].sort(), [
    "chat.message.send",
    "chat.socket.connect",
  ]);
});
