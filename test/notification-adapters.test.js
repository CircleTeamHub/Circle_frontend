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
