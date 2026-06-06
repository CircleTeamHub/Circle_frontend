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
