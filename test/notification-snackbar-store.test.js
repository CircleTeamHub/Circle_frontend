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

const notification = {
  id: "n1",
  type: "TRACE_COMMENT",
  content: "hello",
  read: false,
  createdAt: "2026-06-08T00:00:00.000Z",
  fromUser: { id: "u1", nickname: "Alice", avatarUrl: null },
  fromTrace: { id: "t1", excerpt: "trace", firstImage: null },
  fromReply: { id: "r1", content: "hello" },
  fromCircle: null,
  fromCirclePost: null,
  fromInvitation: null,
};

test("notification snackbar store queues and deduplicates notifications", () => {
  const { useNotificationSnackbarStore } = load(
    "src/features/notifications/store/use-notification-snackbar-store.ts",
  );

  const store = useNotificationSnackbarStore.getState();
  store.reset();
  store.enqueueNotification(notification);
  store.enqueueNotification(notification);

  assert.equal(useNotificationSnackbarStore.getState().queue.length, 1);
  assert.equal(useNotificationSnackbarStore.getState().current.id, "n1");
});

test("notification snackbar store advances to the next item on dismiss", () => {
  const { useNotificationSnackbarStore } = load(
    "src/features/notifications/store/use-notification-snackbar-store.ts",
  );

  const store = useNotificationSnackbarStore.getState();
  store.reset();
  store.enqueueNotification(notification);
  store.enqueueNotification({ ...notification, id: "n2", content: "next" });
  store.dismissCurrent();

  assert.equal(useNotificationSnackbarStore.getState().current.id, "n2");
});

test("notification snackbar store caps queue growth under message floods", () => {
  const { useNotificationSnackbarStore } = load(
    "src/features/notifications/store/use-notification-snackbar-store.ts",
  );

  const store = useNotificationSnackbarStore.getState();
  store.reset();
  for (let i = 0; i < 100; i += 1) {
    store.enqueueNotification({ ...notification, id: `flood-${i}` });
  }

  const { queue, current } = useNotificationSnackbarStore.getState();
  assert.ok(queue.length <= 12, `expected capped queue, got ${queue.length}`);
  // The on-screen item is preserved as the head...
  assert.equal(current.id, "flood-0");
  assert.equal(queue[0].id, "flood-0");
  // ...and the most recent item is retained in the tail.
  assert.equal(queue[queue.length - 1].id, "flood-99");
});

test("notification snackbar store queues chat message targets", () => {
  const { useNotificationSnackbarStore } = load(
    "src/features/notifications/store/use-notification-snackbar-store.ts",
  );

  const store = useNotificationSnackbarStore.getState();
  store.reset();
  store.enqueueChatMessage({
    id: "msg-1",
    title: "Alice",
    summary: "hello",
    avatarUrl: null,
    conversationID: "conversation-1",
    sourceID: "user-1",
    conversationType: "private",
  });

  assert.equal(useNotificationSnackbarStore.getState().current.kind, "chat");
  assert.equal(
    useNotificationSnackbarStore.getState().current.conversationID,
    "conversation-1",
  );
});
