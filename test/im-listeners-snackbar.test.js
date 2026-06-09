const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(rel) {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

test("OpenIM new-message listener delegates to the pure snackbar builder", () => {
  const source = read("src/im/listeners.ts");
  const snackbar = read("src/im/snackbar.ts");

  assert.match(source, /buildChatSnackbar/);
  assert.match(source, /enqueueChatMessage/);
  // No duplicated id-conversion in the listener.
  assert.doesNotMatch(source, /function fromImUserId/);
  // snackbar.ts must stay pure and avoid importing client.ts; client.ts imports
  // listeners.ts, so importing it from snackbar.ts creates a startup require cycle.
  assert.doesNotMatch(snackbar, /from ['"]@\/im\/client['"]/);
  assert.match(snackbar, /from ['"]@\/im\/user-id['"]/);
});

test("chat snackbar copy is internationalized (no hardcoded CJK fallbacks)", () => {
  const source = read("src/im/listeners.ts");

  assert.match(source, /i18n\.t\('chat\.snackbarNewMessage'\)/);
  assert.match(source, /i18n\.t\('chat\.snackbarPreviewFallback'\)/);
  assert.doesNotMatch(source, /'新消息'/);
  assert.doesNotMatch(source, /'\[消息\]'/);
});
