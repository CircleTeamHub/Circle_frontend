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

const { getSnackbarRoute } = load(
  "src/features/notifications/utils/snackbar-route.ts",
);
const OPTS = { untitledPost: "(untitled post)" };

function notification(overrides = {}) {
  return {
    kind: "notification",
    id: "n1",
    type: "TRACE_COMMENT",
    fromCirclePost: null,
    fromTrace: null,
    ...overrides,
  };
}

test("getSnackbarRoute routes chat items to the conversation, with optional avatar", () => {
  const route = getSnackbarRoute(
    {
      kind: "chat",
      conversationID: "conv-1",
      sourceID: "user-1",
      title: "Alice",
      conversationType: "private",
      avatarUrl: "https://cdn/a.png",
    },
    OPTS,
  );

  assert.equal(route.pathname, "/(tabs)/messages/chat-detail");
  assert.equal(route.params.conversationID, "conv-1");
  assert.equal(route.params.sourceID, "user-1");
  assert.equal(route.params.conversationType, "private");
  assert.equal(route.params.avatarUrl, "https://cdn/a.png");
});

test("getSnackbarRoute omits avatarUrl when absent", () => {
  const route = getSnackbarRoute(
    {
      kind: "chat",
      conversationID: "c",
      sourceID: "s",
      title: "t",
      conversationType: "group",
      avatarUrl: null,
    },
    OPTS,
  );
  assert.equal("avatarUrl" in route.params, false);
});

test("getSnackbarRoute routes circle post signups to post-signups", () => {
  const route = getSnackbarRoute(
    notification({
      type: "CIRCLE_POST_SIGNUP_CREATED",
      fromCirclePost: { id: "p1", excerpt: "Hiking trip", firstImage: null },
    }),
    OPTS,
  );
  assert.equal(route.pathname, "/(tabs)/messages/post-signups");
  assert.equal(route.params.postId, "p1");
  assert.equal(route.params.title, "Hiking trip");
});

test("getSnackbarRoute falls back to untitledPost for empty excerpts", () => {
  const route = getSnackbarRoute(
    notification({
      type: "CIRCLE_POST_SIGNUP_CREATED",
      fromCirclePost: { id: "p2", excerpt: "", firstImage: null },
    }),
    OPTS,
  );
  assert.equal(route.params.title, "(untitled post)");
});

test("getSnackbarRoute routes friend requests to new-friends", () => {
  const route = getSnackbarRoute(
    notification({ type: "FRIEND_REQUEST_RECEIVED" }),
    OPTS,
  );
  assert.equal(route, "/(tabs)/contacts/new-friends");
});

test("getSnackbarRoute routes trace-linked notifications to the moment", () => {
  const route = getSnackbarRoute(
    notification({ fromTrace: { id: "t9", excerpt: "x", firstImage: null } }),
    OPTS,
  );
  assert.equal(route.pathname, "/(tabs)/discover/moment/[id]");
  assert.equal(route.params.id, "t9");
});

test("getSnackbarRoute defaults to the notification center", () => {
  const route = getSnackbarRoute(notification(), OPTS);
  assert.equal(route, "/(tabs)/messages/notifications");
});
