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

const t = (key, opts) => (opts && opts.name ? `${key}:${opts.name}` : key);

test("interactive: TRACE_LIKE → heart icon + liked summary", () => {
  const { mapNotificationToRow } = load(
    "src/features/notifications/utils/notification-summary.ts",
  );
  const row = mapNotificationToRow(
    {
      id: "n1",
      type: "TRACE_LIKE",
      content: "",
      read: false,
      createdAt: "2026-06-05T00:00:00Z",
      fromUser: { id: "u2", nickname: "B", avatarUrl: null },
      fromTrace: { id: "t1", excerpt: "body", firstImage: "img1" },
      fromReply: null,
    },
    t,
  );
  assert.equal(row.icon, "heart-outline");
  assert.equal(row.unread, true);
  assert.equal(row.previewImage, "img1");
  assert.equal(row.title, "B");
});

test("interactive: CIRCLE_VERIFICATION_REQUESTED carries invitation id for tap-through", () => {
  const { mapNotificationToRow } = load(
    "src/features/notifications/utils/notification-summary.ts",
  );
  const row = mapNotificationToRow(
    {
      id: "n2",
      type: "CIRCLE_VERIFICATION_REQUESTED",
      content: "",
      read: false,
      createdAt: "2026-06-05T00:00:00Z",
      fromUser: { id: "u3", nickname: "C", avatarUrl: null },
      fromTrace: null,
      fromReply: null,
      fromCircle: { id: "c1", name: "Circle" },
      fromInvitation: { id: "inv9", status: "PENDING" },
    },
    t,
  );
  assert.equal(row.icon, "shield-checkmark-outline");
  assert.equal(row.verificationInvitationId, "inv9");
});

test("interactive: non-verification rows have a null verificationInvitationId", () => {
  const { mapNotificationToRow } = load(
    "src/features/notifications/utils/notification-summary.ts",
  );
  const row = mapNotificationToRow(
    {
      id: "n3",
      type: "TRACE_LIKE",
      content: "",
      read: true,
      createdAt: "2026-06-05T00:00:00Z",
      fromUser: { id: "u4", nickname: "D", avatarUrl: null },
      fromTrace: null,
      fromReply: null,
      fromInvitation: null,
    },
    t,
  );
  assert.equal(row.verificationInvitationId, null);
});

test("signup management: post row uses post excerpt and unread count", () => {
  const { mapMyPostToRow } = load(
    "src/features/notifications/utils/my-post-summary.ts",
  );
  const row = mapMyPostToRow(
    {
      id: "p1",
      circleId: "c",
      circleName: "C",
      excerpt: "Hiking",
      firstImage: "img1",
      signupCount: 3,
      unreadSignupCount: 2,
      createdAt: "2026-06-05T00:00:00Z",
    },
    t,
  );
  assert.equal(row.unread, true);
  assert.equal(row.title, "Hiking");
  assert.equal(row.avatarUrl, "img1");
  assert.equal(row.icon, "megaphone-outline");
  assert.equal(row.summary, "notifications.signupMgmt.rowWithUnread");
});

test("signup management: post row falls back for untitled posts", () => {
  const { mapMyPostToRow } = load(
    "src/features/notifications/utils/my-post-summary.ts",
  );
  const row = mapMyPostToRow(
    {
      id: "p1",
      circleId: "c",
      circleName: "C",
      excerpt: "",
      firstImage: null,
      signupCount: 0,
      unreadSignupCount: 0,
      createdAt: "2026-06-05T00:00:00Z",
    },
    t,
  );
  assert.equal(row.title, "notifications.signupMgmt.untitledPost");
  assert.equal(row.summary, "notifications.signupMgmt.row");
  assert.equal(row.unread, false);
});

test("interactive: iconFor branches → FRIEND_REQUEST person-add", () => {
  const { mapNotificationToRow } = load(
    "src/features/notifications/utils/notification-summary.ts",
  );
  const base = {
    content: "",
    read: false,
    createdAt: "2026-06-05T00:00:00Z",
    fromUser: { id: "u2", nickname: "B", avatarUrl: null },
    fromTrace: null,
    fromReply: null,
  };
  const friend = mapNotificationToRow(
    { ...base, id: "n2", type: "FRIEND_REQUEST_RECEIVED" },
    t,
  );
  assert.equal(friend.icon, "person-add-outline");
});

test("interactive: circle signup notification uses megaphone icon and summary", () => {
  const { mapNotificationToRow } = load(
    "src/features/notifications/utils/notification-summary.ts",
  );
  const row = mapNotificationToRow(
    {
      id: "n4",
      type: "CIRCLE_POST_SIGNUP_CREATED",
      content: "",
      read: false,
      createdAt: "2026-06-05T00:00:00Z",
      fromUser: { id: "u2", nickname: "B", avatarUrl: null },
      fromTrace: null,
      fromReply: null,
      fromCircle: null,
      fromInvitation: null,
      fromCirclePost: { id: "p1", excerpt: "Hiking", firstImage: "img1" },
    },
    t,
  );
  assert.equal(row.icon, "megaphone-outline");
  assert.equal(row.summary, "notifications.summary.CIRCLE_POST_SIGNUP_CREATED");
});

test("interactive: auto-ended circle post notification routes to signup management", () => {
  const { mapNotificationToRow } = load(
    "src/features/notifications/utils/notification-summary.ts",
  );
  const row = mapNotificationToRow(
    {
      id: "n5",
      type: "CIRCLE_POST_AUTO_ENDED",
      content: "",
      read: false,
      createdAt: "2026-06-05T00:00:00Z",
      fromUser: { id: "author-1", nickname: "Host", avatarUrl: null },
      fromTrace: null,
      fromReply: null,
      fromCircle: null,
      fromInvitation: null,
      fromCirclePost: { id: "p1", excerpt: "Hiking", firstImage: null },
    },
    t,
  );
  assert.equal(row.icon, "megaphone-outline");
  assert.equal(row.summary, "notifications.summary.CIRCLE_POST_AUTO_ENDED");
});
