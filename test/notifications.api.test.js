const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function loadApi(filePathRel, apiResponse) {
  const filePath = path.join(process.cwd(), filePathRel);
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

  const calls = [];
  const context = {
    module: { exports: {} },
    exports: {},
    require: (specifier) => {
      if (specifier === "@/services/api/client") {
        return {
          apiClient: async (...args) => {
            calls.push(args);
            return apiResponse;
          },
        };
      }
      if (specifier === "@/utils/validate") {
        return {
          expectShape: (v) => v,
          isPlainObject: () => true,
          isFiniteNonNegativeNumber: () => true,
        };
      }
      if (specifier.startsWith("@/")) {
        // Other @/ imports (e.g. types) are type-only and erased by transpile.
        return {};
      }
      return require(specifier);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return { api: context.module.exports, calls };
}

test("fetchNotifications calls /notification/list with page", async () => {
  const { api, calls } = loadApi("src/services/api/notifications.ts", []);
  await api.fetchNotifications(2);
  assert.equal(calls[0][0], "/notification/list?page=2");
});

test("fetchProfileNotifications calls /notification/profile/list with page", async () => {
  const { api, calls } = loadApi("src/services/api/notifications.ts", []);
  await api.fetchProfileNotifications(3);
  assert.equal(calls[0][0], "/notification/profile/list?page=3");
});

test("markNotificationRead PUTs /notification/:id/read", async () => {
  const { api, calls } = loadApi("src/services/api/notifications.ts", undefined);
  await api.markNotificationRead("n1");
  assert.equal(calls[0][0], "/notification/n1/read");
  assert.equal(calls[0][1].method, "PUT");
});

test("markAllNotificationsRead PUTs /notification/read-all", async () => {
  const { api, calls } = loadApi("src/services/api/notifications.ts", { count: 0 });
  await api.markAllNotificationsRead();
  assert.equal(calls[0][0], "/notification/read-all");
  assert.equal(calls[0][1].method, "PUT");
});

test("deleteNotification DELETEs /notification/:id", async () => {
  const { api, calls } = loadApi("src/services/api/notifications.ts", undefined);
  await api.deleteNotification("n1");
  assert.equal(calls[0][0], "/notification/n1");
  assert.equal(calls[0][1].method, "DELETE");
});

test("registerPushToken PUTs the device push token", async () => {
  const { api, calls } = loadApi("src/services/api/notifications.ts", undefined);
  await api.registerPushToken({
    token: "ExponentPushToken[abc]",
    platform: "ios",
    provider: "expo",
  });
  assert.equal(calls[0][0], "/notification/push-token");
  assert.equal(calls[0][1].method, "PUT");
  assert.deepEqual(calls[0][1].body, {
    token: "ExponentPushToken[abc]",
    platform: "ios",
    provider: "expo",
  });
});

test("deletePushToken DELETEs the stored device push token", async () => {
  const { api, calls } = loadApi("src/services/api/notifications.ts", undefined);
  await api.deletePushToken("ExponentPushToken[abc]", {
    retryOnAuthError: false,
  });
  assert.equal(calls[0][0], "/notification/push-token");
  assert.equal(calls[0][1].method, "DELETE");
  assert.equal(calls[0][1].body.token, "ExponentPushToken[abc]");
  assert.equal(calls[0][1].retryOnAuthError, false);
});
