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
    require: (request) => {
      if (!request.startsWith("@/")) return require(request);
      const target = path.join("src", request.slice(2) + ".ts");
      return fs.existsSync(path.join(process.cwd(), target))
        ? load(target)
        : {};
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

const { getSnackbarRoute } = load(
  "src/features/notifications/utils/snackbar-route.ts",
);
const OPTS = { untitledPost: "(untitled post)" };
const DISCOVER_OPTS = { untitledPost: "(untitled post)", scope: "discover" };

test('notification center routes stay checked by Expo typed routes', () => {
  const files = [
    'src/features/notifications/utils/snackbar-route.ts',
    'src/features/discover/screens/DiscoverScreen.tsx',
  ];

  for (const rel of files) {
    const source = fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
    assert.doesNotMatch(source, /\bas\s+Href\b/);
  }
});

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
      id: "client-msg-1",
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
  // The triggering message id is forwarded so chat detail scrolls to it.
  assert.equal(route.params.searchedMsgID, "client-msg-1");
});

test("getSnackbarRoute omits searchedMsgID when the chat item has no id", () => {
  const route = getSnackbarRoute(
    {
      kind: "chat",
      id: "",
      conversationID: "c",
      sourceID: "s",
      title: "t",
      conversationType: "group",
      avatarUrl: null,
    },
    OPTS,
  );
  assert.equal("searchedMsgID" in route.params, false);
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

test("getSnackbarRoute keeps circle post signups inside the discover stack when requested", () => {
  const route = getSnackbarRoute(
    notification({
      type: "CIRCLE_POST_SIGNUP_CREATED",
      fromCirclePost: { id: "p1", excerpt: "Hiking trip", firstImage: null },
    }),
    DISCOVER_OPTS,
  );
  assert.equal(route.pathname, "/(tabs)/discover/post-signups");
  assert.equal(route.params.postId, "p1");
  assert.equal(route.params.title, "Hiking trip");
});

test("getSnackbarRoute routes a published circle post to the post detail (not the author-only signups page)", () => {
  const route = getSnackbarRoute(
    notification({
      type: "CIRCLE_POST_PUBLISHED",
      fromCirclePost: { id: "p1", excerpt: "Hiking trip", firstImage: null },
    }),
    DISCOVER_OPTS,
  );
  // 收件人是成员，进得去帖子详情报名，进不去作者专属的报名管理页。
  assert.equal(route.pathname, "/(tabs)/discover/plaza-post-detail");
  assert.equal(route.params.id, "p1");
});

test("getSnackbarRoute routes auto-ended circle posts to post-signups", () => {
  const route = getSnackbarRoute(
    notification({
      type: "CIRCLE_POST_AUTO_ENDED",
      fromCirclePost: { id: "p-ended", excerpt: "Board game night", firstImage: null },
    }),
    OPTS,
  );
  assert.equal(route.pathname, "/(tabs)/messages/post-signups");
  assert.equal(route.params.postId, "p-ended");
  assert.equal(route.params.title, "Board game night");
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

test("getSnackbarRoute routes verification requests to the verify screen", () => {
  const route = getSnackbarRoute(
    notification({
      type: "CIRCLE_VERIFICATION_REQUESTED",
      fromInvitation: { id: "inv1", status: "PENDING" },
    }),
    OPTS,
  );
  assert.equal(route.pathname, "/(tabs)/discover/verification/[id]");
  assert.equal(route.params.id, "inv1");
});

test("getSnackbarRoute routes circle invitation result notifications to invitation detail", () => {
  const route = getSnackbarRoute(
    notification({
      type: "CIRCLE_INVITATION_APPROVED",
      fromInvitation: { id: "inv2", status: "APPROVED" },
    }),
    OPTS,
  );
  assert.equal(route.pathname, "/(tabs)/discover/invitation/[id]");
  assert.equal(route.params.id, "inv2");
});

test("getSnackbarRoute falls back when a verification request lacks an invitation id", () => {
  const route = getSnackbarRoute(
    notification({ type: "CIRCLE_VERIFICATION_REQUESTED", fromInvitation: null }),
    OPTS,
  );
  assert.equal(route, "/(tabs)/messages/notifications");
});

test("getSnackbarRoute routes profile likes to the liker's profile per scope", () => {
  const item = notification({
    type: "PROFILE_LIKE",
    fromUser: { id: "user-9", nickname: "小赞", avatarUrl: null },
  });

  const messagesRoute = getSnackbarRoute(item, OPTS);
  assert.equal(messagesRoute.pathname, "/(tabs)/messages/user/[id]");
  assert.equal(messagesRoute.params.id, "user-9");
  assert.equal(messagesRoute.params.name, "小赞");

  const discoverRoute = getSnackbarRoute(item, DISCOVER_OPTS);
  assert.equal(discoverRoute.pathname, "/(tabs)/discover/user/[id]");
  assert.equal(discoverRoute.params.id, "user-9");
  assert.equal(discoverRoute.params.name, "小赞");
});

test("getSnackbarRoute falls back when a profile like lacks the liker", () => {
  const route = getSnackbarRoute(
    notification({ type: "PROFILE_LIKE", fromUser: null }),
    OPTS,
  );
  assert.equal(route, "/(tabs)/messages/notifications");
});

test("getSnackbarRoute routes friend requests to new-friends", () => {
  const route = getSnackbarRoute(
    notification({ type: "FRIEND_REQUEST_RECEIVED" }),
    OPTS,
  );
  assert.equal(route, "/(tabs)/contacts/new-friends");
});

test("getSnackbarRoute routes message-linked notifications to the exact chat message", () => {
  const route = getSnackbarRoute(
    notification({
      type: "MEMBER_MENTION",
      fromMessage: {
        conversationID: "conv-1",
        sourceID: "group-1",
        conversationType: "group",
        title: "Squad",
        clientMsgID: "client-msg-7",
        avatarUrl: "https://cdn/group.png",
      },
    }),
    OPTS,
  );
  assert.equal(route.pathname, "/(tabs)/messages/chat-detail");
  assert.equal(route.params.conversationID, "conv-1");
  assert.equal(route.params.sourceID, "group-1");
  assert.equal(route.params.conversationType, "group");
  assert.equal(route.params.title, "Squad");
  assert.equal(route.params.avatarUrl, "https://cdn/group.png");
  assert.equal(route.params.searchedMsgID, "client-msg-7");
});

test("getSnackbarRoute routes trace-linked notifications to the moment", () => {
  const route = getSnackbarRoute(
    notification({ fromTrace: { id: "t9", excerpt: "x", firstImage: null } }),
    OPTS,
  );
  assert.equal(route.pathname, "/(tabs)/discover/moment/[id]");
  assert.equal(route.params.id, "t9");
});

test("getSnackbarRoute carries reply anchors into moment detail", () => {
  const route = getSnackbarRoute(
    notification({
      fromTrace: { id: "t9", excerpt: "x", firstImage: null },
      fromReply: { id: "r7", content: "reply" },
    }),
    OPTS,
  );
  assert.equal(route.pathname, "/(tabs)/discover/moment/[id]");
  assert.equal(route.params.id, "t9");
  assert.equal(route.params.targetCommentId, "r7");
});

test("getSnackbarRoute defaults to the notification center", () => {
  const route = getSnackbarRoute(notification(), OPTS);
  assert.equal(route, "/(tabs)/messages/notifications");
});

test("getSnackbarRoute defaults to the discover notification center for discover scope", () => {
  // 不属于任何铃铛的类型（SYSTEM 等）落在不限域的通知中心。
  const route = getSnackbarRoute(
    notification({ type: "SYSTEM" }),
    DISCOVER_OPTS,
  );
  assert.equal(route, "/(tabs)/discover/notification-center");
});

test("getSnackbarRoute's discover fallback lands in the bell that owns the type", () => {
  const circle = getSnackbarRoute(
    notification({ type: "CIRCLE_POST_PUBLISHED" }),
    DISCOVER_OPTS,
  );
  assert.equal(circle.pathname, "/(tabs)/discover/notification-center");
  assert.equal(circle.params.domain, "circle");

  const moments = getSnackbarRoute(
    notification({ type: "TRACE_LIKE" }),
    DISCOVER_OPTS,
  );
  assert.equal(moments.pathname, "/(tabs)/discover/notification-center");
  assert.equal(moments.params.domain, "moments");
});
