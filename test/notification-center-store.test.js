const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function load(rel) {
  const filePath = path.join(process.cwd(), rel);
  const source = fs.readFileSync(filePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      baseUrl: process.cwd(),
      paths: { "@/*": ["src/*"] },
    },
    fileName: filePath,
  }).outputText;
  const context = {
    module: { exports: {} },
    exports: {},
    require: (s) => (s.startsWith("@/") ? {} : require(s)),
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

test("markInteractiveReadLocal flips read flag", () => {
  const { useNotificationCenterStore } = load(
    "src/features/notifications/store/use-notification-center-store.ts",
  );
  const store = useNotificationCenterStore.getState();
  store.setInteractive([
    { id: "n1", type: "SYSTEM", content: "x", read: false, createdAt: "", fromUser: null, fromTrace: null, fromReply: null },
  ]);
  store.markInteractiveReadLocal("n1");
  assert.equal(useNotificationCenterStore.getState().interactive[0].read, true);
});

test("removeInteractiveLocal drops the row", () => {
  const { useNotificationCenterStore } = load(
    "src/features/notifications/store/use-notification-center-store.ts",
  );
  const store = useNotificationCenterStore.getState();
  store.setInteractive([
    { id: "n1", type: "SYSTEM", content: "x", read: false, createdAt: "", fromUser: null, fromTrace: null, fromReply: null },
  ]);
  store.removeInteractiveLocal("n1");
  assert.equal(useNotificationCenterStore.getState().interactive.length, 0);
});

test("appendInteractivePage appends newer pages without duplicating rows", () => {
  const { useNotificationCenterStore } = load(
    "src/features/notifications/store/use-notification-center-store.ts",
  );
  const store = useNotificationCenterStore.getState();
  const first = { id: "n1", type: "SYSTEM", content: "x", read: false, createdAt: "", fromUser: null, fromTrace: null, fromReply: null };
  const second = { ...first, id: "n2", content: "y" };
  store.setInteractive([first]);
  store.appendInteractivePage([first, second]);

  assert.equal(
    useNotificationCenterStore.getState().interactive.map((item) => item.id).join(","),
    "n1,n2",
  );
});

test("markPostSignupsSeenLocal clears unread signup count", () => {
  const { useNotificationCenterStore } = load(
    "src/features/notifications/store/use-notification-center-store.ts",
  );
  const store = useNotificationCenterStore.getState();
  store.setSignupPosts([
    { id: "p1", circleId: "c", circleName: "C", excerpt: "Post", firstImage: null, signupCount: 2, unreadSignupCount: 2, createdAt: "" },
  ]);
  store.markPostSignupsSeenLocal("p1");
  assert.equal(useNotificationCenterStore.getState().signupPosts[0].unreadSignupCount, 0);
});
