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
    "CIRCLE_POST_AUTO_ENDED",
    "CIRCLE_POST_COLLABORATION_RECOGNIZED",
    // 圈子的事一律在飞机：收到圈子邀请、被移出圈子、圈子解散。
    "CIRCLE_INVITATION_RECEIVED",
    "CIRCLE_MEMBER_REMOVED",
    "CIRCLE_DISSOLVED",
  ]) {
    assert.equal(notificationDomain(type), "circle", type);
  }

  // 消息页「通知」的群聊知会：独立群的被移出 / 解散。
  for (const type of ["GROUP_MEMBER_REMOVED", "GROUP_DISSOLVED"]) {
    assert.equal(notificationDomain(type), "group", type);
    assert.equal(BELL_NOTIFICATION_TYPES.has(type), true, type);
  }
  // 公告归「通知」的系统分类，但不推 notification.created，不进实时插入的白名单。
  assert.equal(notificationDomain("SYSTEM"), "system");
  assert.equal(BELL_NOTIFICATION_TYPES.has("SYSTEM"), false);

  // 好友申请 / 入群申请有专属「新的朋友」收件箱，不进任何列表。
  for (const type of [
    "FRIEND_REQUEST_RECEIVED",
    "FRIEND_REQUEST_ACCEPTED",
    "FRIEND_REQUEST_REJECTED",
    "GROUP_ADMISSION",
    // 报名走 signupUnread / seenByAuthor 与报名管理 tab，不计入互动铃铛。
    "CIRCLE_POST_SIGNUP_CREATED",
    "MESSAGE_RECEIVED",
  ]) {
    assert.equal(notificationDomain(type), null, type);
    assert.equal(BELL_NOTIFICATION_TYPES.has(type), false, type);
  }
});

test("the message-page notice domain covers everything outside the circle", () => {
  const { isNotificationInDomain } = load(DOMAIN);
  for (const type of ["TRACE_LIKE", "GROUP_MEMBER_REMOVED", "GROUP_DISSOLVED", "SYSTEM"]) {
    assert.equal(isNotificationInDomain(type, "notice"), true, type);
  }
  for (const type of ["CIRCLE_MEMBER_REMOVED", "CIRCLE_INVITATION_RECEIVED", "FRIEND_REQUEST_RECEIVED"]) {
    assert.equal(isNotificationInDomain(type, "notice"), false, type);
  }
  // 分类只收自己那一类；不限域（推送兜底页）什么都收。
  assert.equal(isNotificationInDomain("GROUP_DISSOLVED", "group"), true);
  assert.equal(isNotificationInDomain("TRACE_LIKE", "group"), false);
  assert.equal(isNotificationInDomain("SYSTEM", "system"), true);
  assert.equal(isNotificationInDomain("CIRCLE_DISSOLVED", null), true);
});

test("parseNotificationDomain rejects anything but the known entry domains", () => {
  const { parseNotificationDomain } = load(DOMAIN);

  for (const domain of ["moments", "circle", "notice", "group", "system"]) {
    assert.equal(parseNotificationDomain(domain), domain);
  }
  for (const bogus of [undefined, null, "", "interactive", "CIRCLE", 1, {}]) {
    assert.equal(parseNotificationDomain(bogus), null);
  }
});

test("refreshing one bell never drops the other bell's rows", () => {
  const { useNotificationCenterStore } = load(STORE);
  const store = useNotificationCenterStore.getState();

  const circleRow = notification("c1", "CIRCLE_POST_AUTO_ENDED", {
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
      ["GROUP_NOTICE_NOTIFICATION_TYPES", "group"],
      ["PROFILE_NOTIFICATION_TYPES", "system"],
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
    const backendByDomain = {
      moments: backendTypeSet(backend, "MOMENT_NOTIFICATION_TYPES"),
      circle: backendTypeSet(backend, "CIRCLE_NOTIFICATION_TYPES"),
      group: backendTypeSet(backend, "GROUP_NOTICE_NOTIFICATION_TYPES"),
    };
    const feSource = fs.readFileSync(path.join(process.cwd(), DOMAIN), "utf8");
    for (const type of [...load(DOMAIN).BELL_NOTIFICATION_TYPES]) {
      const domain = notificationDomain(type);
      const expected = backendByDomain[domain];
      assert.ok(
        expected.has(type),
        `client puts ${type} in ${domain} but the backend does not`,
      );
    }
    assert.ok(feSource.includes("notification.constants.ts"));
  },
);
