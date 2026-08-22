const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

// 递归解析 @/ 别名，这样被测模块和它依赖的纯逻辑模块都跑真实实现
// （notification-center-store 依赖 notification-domain 的分域判断）。
const cache = new Map();

function load(rel) {
  const filePath = path.join(process.cwd(), rel);
  if (cache.has(filePath)) return cache.get(filePath);

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
      const target = path.join("src", request.slice(2));
      for (const ext of [".ts", ".tsx", "/index.ts"]) {
        if (fs.existsSync(path.join(process.cwd(), target + ext))) {
          return load(target + ext);
        }
      }
      return {};
    },
  };
  context.exports = context.module.exports;
  cache.set(filePath, context.module.exports);
  vm.runInNewContext(transpiled, context, { filename: filePath });
  cache.set(filePath, context.module.exports);
  return context.module.exports;
}

const DOMAIN = "src/features/notifications/utils/notification-domain.ts";
const STORE = "src/features/notifications/store/use-notification-center-store.ts";

function notification(id, type, overrides = {}) {
  return {
    id,
    type,
    content: "",
    read: false,
    createdAt: "2026-08-15T00:00:00.000Z",
    fromUser: null,
    fromTrace: null,
    fromReply: null,
    fromCircle: null,
    fromCirclePost: null,
    fromInvitation: null,
    ...overrides,
  };
}

test("moments and circle bells claim disjoint notification types", () => {
  const { notificationDomain, BELL_NOTIFICATION_TYPES } = load(DOMAIN);

  for (const type of [
    "TRACE_LIKE",
    "TRACE_COMMENT",
    "COMMENT_REPLY",
    "TRACE_MENTION",
    "PROFILE_LIKE",
  ]) {
    assert.equal(notificationDomain(type), "moments", type);
  }

  for (const type of [
    "CIRCLE_VERIFICATION_REQUESTED",
    "CIRCLE_INVITATION_APPROVED",
    "CIRCLE_INVITATION_REJECTED",
    "CIRCLE_ADMIN_OVERRIDE_APPROVED",
    "CIRCLE_POST_PUBLISHED",
    "CIRCLE_POST_AUTO_ENDED",
    "CIRCLE_POST_COLLABORATION_RECOGNIZED",
  ]) {
    assert.equal(notificationDomain(type), "circle", type);
  }

  // 好友申请有专属「新的朋友」收件箱，系统公告在「我」页，两个铃铛都不收。
  for (const type of [
    "FRIEND_REQUEST_RECEIVED",
    "FRIEND_REQUEST_ACCEPTED",
    "FRIEND_REQUEST_REJECTED",
    // 报名走 signupUnread / seenByAuthor 与报名管理 tab，不计入互动铃铛。
    "CIRCLE_POST_SIGNUP_CREATED",
    "SYSTEM",
    "MESSAGE_RECEIVED",
  ]) {
    assert.equal(notificationDomain(type), null, type);
    assert.equal(BELL_NOTIFICATION_TYPES.has(type), false, type);
  }
});

test("parseNotificationDomain rejects anything but the two bell domains", () => {
  const { parseNotificationDomain } = load(DOMAIN);

  assert.equal(parseNotificationDomain("moments"), "moments");
  assert.equal(parseNotificationDomain("circle"), "circle");
  for (const bogus of [undefined, null, "", "interactive", "CIRCLE", 1, {}]) {
    assert.equal(parseNotificationDomain(bogus), null);
  }
});

test("refreshing one bell never drops the other bell's rows", () => {
  const { useNotificationCenterStore } = load(STORE);
  const store = useNotificationCenterStore.getState();

  const circleRow = notification("c1", "CIRCLE_POST_PUBLISHED", {
    createdAt: "2026-08-15T02:00:00.000Z",
  });
  const staleMoment = notification("m1", "TRACE_LIKE", {
    createdAt: "2026-08-15T01:00:00.000Z",
  });
  store.setInteractive([circleRow, staleMoment]);

  // 朋友圈铃铛刷新：只换掉 moments 的行，圈子的行原样保留。
  const freshMoment = notification("m2", "TRACE_COMMENT", {
    createdAt: "2026-08-15T03:00:00.000Z",
  });
  store.setInteractiveForDomain("moments", [freshMoment]);

  // vm 里造出来的数组是跨 realm 的，用字符串比较避开 deepStrictEqual 的原型检查。
  const ids = useNotificationCenterStore
    .getState()
    .interactive.map((item) => item.id)
    .join(",");
  assert.equal(ids, "m2,c1");
});

test("mark-all-read in one bell leaves the other bell unread", () => {
  const { useNotificationCenterStore } = load(STORE);
  const store = useNotificationCenterStore.getState();

  store.setInteractive([
    notification("m1", "TRACE_LIKE"),
    notification("c1", "CIRCLE_VERIFICATION_REQUESTED"),
    notification("f1", "FRIEND_REQUEST_RECEIVED"),
  ]);

  store.markDomainInteractiveReadLocal("moments");

  const byId = Object.fromEntries(
    useNotificationCenterStore
      .getState()
      .interactive.map((item) => [item.id, item.read]),
  );
  assert.equal(byId.m1, true);
  assert.equal(byId.c1, false);
  // 不属于任何铃铛的行也不该被某个铃铛的「全部已读」顺手清掉。
  assert.equal(byId.f1, false);
});

test("an unscoped mark-all-read still clears everything (push fallback screen)", () => {
  const { useNotificationCenterStore } = load(STORE);
  const store = useNotificationCenterStore.getState();

  store.setInteractive([
    notification("m1", "TRACE_LIKE"),
    notification("c1", "CIRCLE_POST_AUTO_ENDED"),
  ]);
  store.markDomainInteractiveReadLocal(null);

  assert.ok(
    useNotificationCenterStore.getState().interactive.every((n) => n.read),
  );
});

// 铃铛分域是跨仓契约：服务端按同一套类型白名单算 momentsUnread / circleUnread
// 并按 domain 过滤列表。任一侧漏一个类型 = 服务端算进红点、客户端列表里看不到，
// 红点永远清不掉。双仓并排检出时逐项对齐，仅前端 CI 时跳过。
const BACKEND_CONSTANTS_PATH = path.join(
  path.resolve(
    process.env.CIRCLE_BE_DIR || path.join(process.cwd(), "..", "circle_be"),
  ),
  "src/notification/notification.constants.ts",
);
const hasBackend = fs.existsSync(BACKEND_CONSTANTS_PATH);

function backendTypeSet(source, constName) {
  const block = source.match(
    new RegExp(`${constName} = compactNotificationTypes\\(\\[([\\s\\S]*?)\\] as const\\)`),
  );
  assert.ok(block, `backend missing ${constName}`);
  return new Set(
    [...block[1].matchAll(/NotificationType\.([A-Z_]+)/g)].map((m) => m[1]),
  );
}

test(
  "bell domain type whitelists match the backend constants",
  { skip: !hasBackend && "circle_be not checked out beside circle-im" },
  () => {
    const backend = fs.readFileSync(BACKEND_CONSTANTS_PATH, "utf8");
    const { notificationDomain } = load(DOMAIN);

    for (const [constName, domain] of [
      ["MOMENT_NOTIFICATION_TYPES", "moments"],
      ["CIRCLE_NOTIFICATION_TYPES", "circle"],
    ]) {
      for (const type of backendTypeSet(backend, constName)) {
        assert.equal(
          notificationDomain(type),
          domain,
          `${type} is ${domain} on the backend but not on the client`,
        );
      }
    }

    // 反向：客户端认领的每个类型也必须在后端对应的白名单里。
    const beMoments = backendTypeSet(backend, "MOMENT_NOTIFICATION_TYPES");
    const beCircle = backendTypeSet(backend, "CIRCLE_NOTIFICATION_TYPES");
    const feSource = fs.readFileSync(path.join(process.cwd(), DOMAIN), "utf8");
    for (const type of [...load(DOMAIN).BELL_NOTIFICATION_TYPES]) {
      const domain = notificationDomain(type);
      const expected = domain === "moments" ? beMoments : beCircle;
      assert.ok(
        expected.has(type),
        `client puts ${type} in ${domain} but the backend does not`,
      );
    }
    assert.ok(feSource.includes("notification.constants.ts"));
  },
);
