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

test("circle: POST_SIGNUP_RECEIVED → uses post excerpt", () => {
  const { mapActivityToRow } = load(
    "src/features/notifications/utils/circle-activity-summary.ts",
  );
  const row = mapActivityToRow(
    {
      id: "a1",
      circleId: "c1",
      circleName: "C",
      invitationId: null,
      type: "POST_SIGNUP_RECEIVED",
      actor: { id: "u2", nickname: "B", avatarUrl: null, accountId: "2" },
      readAt: null,
      createdAt: "2026-06-05T00:00:00Z",
      post: { id: "p1", excerpt: "Hiking" },
    },
    t,
  );
  assert.equal(row.unread, true);
  assert.ok(row.summary.includes("Hiking"));
  assert.equal(row.title, "B");
});

// Interpolating stub mimicking react-i18next: when the activity template owns a
// {{post}} slot, the excerpt is already woven into the label by i18next itself.
const tInterp = (key, opts) =>
  key.endsWith("RECEIVED") && opts && opts.post != null
    ? `报名了你的帖子：${opts.post}`
    : key;

test("circle: POST_SIGNUP_RECEIVED dedupe guard → excerpt appears exactly once under interpolation", () => {
  const { mapActivityToRow } = load(
    "src/features/notifications/utils/circle-activity-summary.ts",
  );
  const row = mapActivityToRow(
    {
      id: "a1",
      circleId: "c1",
      circleName: "C",
      invitationId: null,
      type: "POST_SIGNUP_RECEIVED",
      actor: { id: "u2", nickname: "B", avatarUrl: null, accountId: "2" },
      readAt: null,
      createdAt: "2026-06-05T00:00:00Z",
      post: { id: "p1", excerpt: "Hiking" },
    },
    tInterp,
  );
  // The real i18n path: label already contains the excerpt, so the append branch
  // must be suppressed — no ` · Hiking` duplication.
  assert.equal(row.summary, "报名了你的帖子：Hiking");
  assert.equal(row.summary.split("Hiking").length - 1, 1);
  assert.ok(!row.summary.includes(" · "));
});

test("circle: VERIFICATION_APPROVED with null post → no trailing separator (falsy-excerpt guard)", () => {
  const { mapActivityToRow } = load(
    "src/features/notifications/utils/circle-activity-summary.ts",
  );
  const row = mapActivityToRow(
    {
      id: "a2",
      circleId: "c1",
      circleName: "C",
      invitationId: null,
      type: "VERIFICATION_APPROVED",
      actor: { id: "u2", nickname: "B", avatarUrl: null, accountId: "2" },
      readAt: null,
      createdAt: "2026-06-05T00:00:00Z",
      post: null,
    },
    tInterp,
  );
  // excerpt resolves to '' → append branch suppressed, label is surfaced as-is.
  assert.equal(row.summary, "notifications.activity.VERIFICATION_APPROVED");
  assert.ok(!row.summary.includes(" · "));
  assert.ok(!row.summary.endsWith("· "));
  assert.ok(!row.summary.endsWith(" · "));
});

test("circle: iconFor branches → VERIFICATION shield, other people-circle", () => {
  const { mapActivityToRow } = load(
    "src/features/notifications/utils/circle-activity-summary.ts",
  );
  const base = {
    id: "a3",
    circleId: "c1",
    circleName: "C",
    invitationId: null,
    actor: { id: "u2", nickname: "B", avatarUrl: null, accountId: "2" },
    readAt: null,
    createdAt: "2026-06-05T00:00:00Z",
    post: null,
  };
  const verification = mapActivityToRow(
    { ...base, type: "VERIFICATION_APPROVED" },
    t,
  );
  assert.equal(verification.icon, "shield-checkmark-outline");

  const other = mapActivityToRow(
    { ...base, type: "MEMBER_JOINED" },
    t,
  );
  assert.equal(other.icon, "people-circle-outline");
});

test("interactive: iconFor branches → FRIEND_REQUEST person-add, SQUAD_REQUEST people", () => {
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

  const squad = mapNotificationToRow(
    { ...base, id: "n3", type: "SQUAD_REQUEST_RECEIVED" },
    t,
  );
  assert.equal(squad.icon, "people-outline");
});
