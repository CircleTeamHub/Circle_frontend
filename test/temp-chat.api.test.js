const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function loadTempChatApi(apiResponse) {
  const filePath = path.join(process.cwd(), "src/services/api/temp-chat.ts");
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
      return require(specifier);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return { api: context.module.exports, calls };
}

test("fetchMyTempChats maps backend list rows for the seat management screen", async () => {
  const { api, calls } = loadTempChatApi([
    {
      id: "tc-1",
      groupId: "tmpABC",
      title: "售前咨询",
      status: "ACTIVE",
      guestCount: 2,
      memberCount: 3,
      maxMembers: 10,
      expiresAt: "2999-06-06T00:00:00.000Z",
      createdAt: "2026-06-05T00:00:00.000Z",
      endedAt: null,
      shareUrl: "https://chat.example.com/t/token",
    },
  ]);

  const rooms = await api.fetchMyTempChats();

  assert.deepEqual(calls[0], ["/temp-chat/mine"]);
  assert.deepEqual(JSON.parse(JSON.stringify(rooms)), [
    {
      id: "tc-1",
      groupId: "tmpABC",
      title: "售前咨询",
      status: "ACTIVE",
      guestCount: 2,
      memberCount: 3,
      maxMembers: 10,
      expiresAt: "2999-06-06T00:00:00.000Z",
      createdAt: "2026-06-05T00:00:00.000Z",
      endedAt: null,
      shareUrl: "https://chat.example.com/t/token",
      isActive: true,
      isExpired: false,
    },
  ]);
});

test("fetchMyTempChats derives isActive/isExpired across status + expiry edge cases", async () => {
  const baseRow = (overrides) => ({
    id: "r",
    groupId: "g",
    title: "t",
    status: "ACTIVE",
    guestCount: 0,
    memberCount: 1,
    maxMembers: 10,
    expiresAt: "2026-06-06T00:00:00.000Z",
    createdAt: "2026-06-05T00:00:00.000Z",
    endedAt: null,
    shareUrl: null,
    ...overrides,
  });

  const { api } = loadTempChatApi([
    // ACTIVE but expiry already in the past → treated as expired, not active.
    baseRow({ id: "stale", expiresAt: "2000-01-01T00:00:00.000Z" }),
    // Server-side EXPIRED status wins regardless of expiresAt.
    baseRow({ id: "exp", status: "EXPIRED", expiresAt: "2999-01-01T00:00:00.000Z" }),
    // ENDED is neither active nor expired.
    baseRow({ id: "ended", status: "ENDED", endedAt: "2026-06-05T01:00:00.000Z" }),
    // Unparseable expiresAt must not flip an ACTIVE room to expired.
    baseRow({ id: "bad-date", expiresAt: "not-a-date" }),
  ]);

  const rooms = await api.fetchMyTempChats();
  const byId = Object.fromEntries(rooms.map((r) => [r.id, r]));

  assert.deepEqual(
    { active: byId.stale.isActive, expired: byId.stale.isExpired },
    { active: false, expired: true },
  );
  assert.deepEqual(
    { active: byId.exp.isActive, expired: byId.exp.isExpired },
    { active: false, expired: true },
  );
  assert.deepEqual(
    { active: byId.ended.isActive, expired: byId.ended.isExpired },
    { active: false, expired: false },
  );
  assert.deepEqual(
    { active: byId["bad-date"].isActive, expired: byId["bad-date"].isExpired },
    { active: true, expired: false },
  );
});

test("isTempChatOpenable re-checks live expiry before entering a room", () => {
  const { api } = loadTempChatApi([]);
  const now = Date.parse("2026-06-05T00:00:00.000Z");

  // ACTIVE with future expiry → openable.
  assert.equal(
    api.isTempChatOpenable(
      { status: "ACTIVE", expiresAt: "2026-06-06T00:00:00.000Z" },
      now,
    ),
    true,
  );
  // ACTIVE but expiry already passed → not openable (stale snapshot).
  assert.equal(
    api.isTempChatOpenable(
      { status: "ACTIVE", expiresAt: "2026-06-04T00:00:00.000Z" },
      now,
    ),
    false,
  );
  // Non-active status → never openable regardless of expiry.
  assert.equal(
    api.isTempChatOpenable(
      { status: "ENDED", expiresAt: "2999-01-01T00:00:00.000Z" },
      now,
    ),
    false,
  );
  // Unparseable expiry must not block an ACTIVE room.
  assert.equal(
    api.isTempChatOpenable({ status: "ACTIVE", expiresAt: "nope" }, now),
    true,
  );
});

test("media preflight rejects stale temp conversations before upload", async () => {
  const { api } = loadTempChatApi([
    {
      id: "active",
      groupId: "tmp-active",
      conversationId: "conv-active",
      status: "ACTIVE",
      expiresAt: "2999-06-06T00:00:00.000Z",
    },
    {
      id: "expired",
      groupId: "tmp-expired",
      conversationId: "conv-expired",
      status: "EXPIRED",
      expiresAt: "2999-06-06T00:00:00.000Z",
    },
  ]);

  await api.assertMyTempChatConversationOpen("conv-active");
  await assert.rejects(
    () => api.assertMyTempChatConversationOpen("conv-expired"),
    (error) => error.name === "TempChatUnavailableError",
  );
  await assert.rejects(
    () => api.assertMyTempChatConversationOpen("conv-missing"),
    (error) => error.name === "TempChatUnavailableError",
  );
});

test("createTempChat posts default creation payload and maps the created room", async () => {
  const { api, calls } = loadTempChatApi({
    id: "tc-created",
    groupId: "tmpCreated",
    title: "临时聊天",
    maxMembers: 50,
    expiresAt: "2026-06-08T00:00:00.000Z",
    shareUrl: "https://chat.example.com/t/new-token",
  });

  const room = await api.createTempChat();

  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), [
    "/temp-chat",
    {
      method: "POST",
      body: {},
    },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(room)), {
    id: "tc-created",
    groupId: "tmpCreated",
    title: "临时聊天",
    maxMembers: 50,
    expiresAt: "2026-06-08T00:00:00.000Z",
    shareUrl: "https://chat.example.com/t/new-token",
  });
});

test("createTempChat forwards a custom creation payload", async () => {
  const { api, calls } = loadTempChatApi({
    id: "tc-x",
    groupId: "tmpX",
    title: "周末爬山",
    maxMembers: 20,
    expiresAt: "2026-06-05T01:00:00.000Z",
    shareUrl: "https://chat.example.com/t/x",
  });

  await api.createTempChat({
    title: "周末爬山",
    ttlMinutes: 60,
    maxMembers: 20,
  });

  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), [
    "/temp-chat",
    {
      method: "POST",
      body: { title: "周末爬山", ttlMinutes: 60, maxMembers: 20 },
    },
  ]);
});

test("endTempChat posts to the end endpoint and returns the new status", async () => {
  const { api, calls } = loadTempChatApi({ status: "ENDED" });

  const result = await api.endTempChat("tc-1");

  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), [
    "/temp-chat/tc-1/end",
    { method: "POST" },
  ]);
  assert.deepEqual(result, { status: "ENDED" });
});
