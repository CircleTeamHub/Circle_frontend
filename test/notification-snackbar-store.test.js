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

// ---- 同一个会话只留一条横幅 --------------------------------------------------
// 原来每条消息排一个横幅(各 4 秒):群一多,横幅一个接一个停不下来,每个都要重新进场、
// 再响一次;安卓上横幅还是实时毛玻璃,显示期间整个界面每帧多画一遍。

function chat(id, conversationID, summary = id) {
  return {
    id,
    title: conversationID,
    summary,
    avatarUrl: null,
    conversationID,
    sourceID: conversationID,
    conversationType: "group",
  };
}

test("a newer chat message replaces the queued banner of the same conversation in place", () => {
  const { useNotificationSnackbarStore } = load(
    "src/features/notifications/store/use-notification-snackbar-store.ts",
  );
  const store = useNotificationSnackbarStore.getState();
  store.reset();
  store.enqueueNotification(notification);
  store.enqueueChatMessage(chat("a1", "group-a"));
  store.enqueueChatMessage(chat("b1", "group-b"));
  store.enqueueChatMessage(chat("a2", "group-a"));

  assert.deepEqual(
    Array.from(useNotificationSnackbarStore.getState().queue, (item) => item.id),
    ["n1", "a2", "b1"],
  );
});

test("a newer chat message updates the banner on screen without becoming a new banner", () => {
  const { useNotificationSnackbarStore, snackbarBannerKey } = load(
    "src/features/notifications/store/use-notification-snackbar-store.ts",
  );
  const store = useNotificationSnackbarStore.getState();
  store.reset();
  store.enqueueChatMessage(chat("a1", "group-a", "first"));
  store.enqueueChatMessage(chat("a2", "group-a", "second"));

  const { queue, current } = useNotificationSnackbarStore.getState();
  assert.equal(queue.length, 1);
  assert.equal(current.summary, "second");
  // 界面按这个判断是不是同一个横幅:同一个就只换内容,不重新进场。
  assert.equal(snackbarBannerKey(current), "a1");

  // 那条横幅收起之后再来的消息,是一条新横幅。
  useNotificationSnackbarStore.getState().dismissCurrent();
  useNotificationSnackbarStore.getState().enqueueChatMessage(chat("a3", "group-a"));
  assert.equal(snackbarBannerKey(useNotificationSnackbarStore.getState().current), "a3");
});

test("system notifications are never merged with each other", () => {
  const { useNotificationSnackbarStore } = load(
    "src/features/notifications/store/use-notification-snackbar-store.ts",
  );
  const store = useNotificationSnackbarStore.getState();
  store.reset();
  store.enqueueNotification(notification);
  store.enqueueNotification({ ...notification, id: "n2" });
  assert.equal(useNotificationSnackbarStore.getState().queue.length, 2);
});

test("a redelivered older message does not take the merged banner back", () => {
  // 重连后服务端可能把已经被替换掉的旧消息再投一遍:它不能把横幅换回旧内容。
  const { useNotificationSnackbarStore } = load(
    "src/features/notifications/store/use-notification-snackbar-store.ts",
  );
  const store = useNotificationSnackbarStore.getState();
  store.reset();
  store.enqueueChatMessage(chat("a1", "group-a", "first"));
  store.enqueueChatMessage(chat("b1", "group-b"));
  store.enqueueChatMessage(chat("b2", "group-b", "second"));
  store.enqueueChatMessage(chat("a2", "group-a", "second"));
  store.enqueueChatMessage(chat("a1", "group-a", "first"));
  store.enqueueChatMessage(chat("b1", "group-b", "first"));

  const { queue } = useNotificationSnackbarStore.getState();
  assert.deepEqual(
    Array.from(queue, (item) => item.summary),
    ["second", "second"],
  );
});
