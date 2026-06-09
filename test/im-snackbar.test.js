const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

// Canonical id conversion mirrored from src/im/client.ts so the builder can run
// in isolation (client.ts itself pulls in the native OpenIM SDK).
function fromImUserId(userId) {
  if (userId.includes("-")) return userId;
  if (userId.length !== 32) return userId;
  return [
    userId.slice(0, 8),
    userId.slice(8, 12),
    userId.slice(12, 16),
    userId.slice(16, 20),
    userId.slice(20),
  ].join("-");
}

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
    require: (s) => {
      if (s === "@/im/client") return { fromImUserId };
      if (s.startsWith("@/")) return {};
      return require(s);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

const { buildChatSnackbar } = load("src/im/snackbar.ts");
const SINGLE = false;
const GROUP = true;
const FALLBACKS = { title: "New message", preview: "[Message]" };
const ME = "me-uuid";

function singleMessage(overrides = {}) {
  return {
    clientMsgID: "msg-1",
    sendID: "11111111111111111111111111111111",
    recvID: ME,
    groupID: "",
    content: "hi there",
    senderNickname: "Alice",
    senderFaceUrl: "https://cdn/a.png",
    ...overrides,
  };
}

test("buildChatSnackbar skips the user's own messages", () => {
  const payload = buildChatSnackbar(
    singleMessage({ sendID: ME }),
    [],
    ME,
    SINGLE,
    FALLBACKS,
  );
  assert.equal(payload, null);
});

test("buildChatSnackbar uses the synced conversation for single chats", () => {
  const message = singleMessage();
  const conversation = {
    conversationID: "conv-1",
    userID: message.sendID,
    showName: "Alice (contact)",
    faceURL: "https://cdn/contact.png",
    conversationType: 1,
  };
  const payload = buildChatSnackbar(message, [conversation], ME, SINGLE, FALLBACKS);

  assert.equal(payload.title, "Alice (contact)");
  assert.equal(payload.avatarUrl, "https://cdn/contact.png");
  assert.equal(payload.conversationID, "conv-1");
  assert.equal(payload.conversationType, "private");
  // sourceID is the app-side UUID derived from the IM hex id.
  assert.equal(payload.sourceID, "11111111-1111-1111-1111-111111111111");
});

test("buildChatSnackbar falls back to message fields for unsynced single chats", () => {
  const payload = buildChatSnackbar(singleMessage(), [], ME, SINGLE, FALLBACKS);

  assert.equal(payload.title, "Alice");
  assert.equal(payload.avatarUrl, "https://cdn/a.png");
  assert.equal(payload.conversationID, "");
  assert.equal(payload.sourceID, "11111111-1111-1111-1111-111111111111");
});

test("buildChatSnackbar uses fallbacks for nameless, non-text messages", () => {
  const payload = buildChatSnackbar(
    singleMessage({ senderNickname: "", content: "" }),
    [],
    ME,
    SINGLE,
    FALLBACKS,
  );

  assert.equal(payload.title, "New message");
  assert.equal(payload.summary, "[Message]");
});

test("buildChatSnackbar shows group banners only when the conversation is synced", () => {
  const message = {
    clientMsgID: "g-1",
    sendID: "22222222222222222222222222222222",
    groupID: "group-9",
    content: "team update",
    senderNickname: "Bob",
    senderFaceUrl: "",
  };

  // Unsynced group → dropped (no reliable group name).
  assert.equal(buildChatSnackbar(message, [], ME, GROUP, FALLBACKS), null);

  // Synced group → uses the group's own name + id.
  const conversation = {
    conversationID: "conv-g",
    groupID: "group-9",
    showName: "Team Circle",
    faceURL: "https://cdn/g.png",
    conversationType: 3,
  };
  const payload = buildChatSnackbar(message, [conversation], ME, GROUP, FALLBACKS);
  assert.equal(payload.title, "Team Circle");
  assert.equal(payload.sourceID, "group-9");
  assert.equal(payload.conversationType, "group");
});
