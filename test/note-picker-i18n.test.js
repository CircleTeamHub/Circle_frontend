const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), rel), "utf8"));
}
function read(rel) {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

const en = readJson("src/i18n/locales/en.json");
const zh = readJson("src/i18n/locales/zh.json");

const NOTE_PICKER_KEYS = [
  "title",
  "searchPlaceholder",
  "none",
  "empty",
  "loadFailed",
  "selectA11y",
  "noneA11y",
];
const BACKGROUND_KEYS = [
  "title",
  "customImage",
  "statusUploading",
  "statusSet",
  "statusChoose",
  "paramMissing",
  "cannotModify",
  "failedTitle",
  "failedBody",
];

test("note picker copy exists in both locales", () => {
  for (const key of NOTE_PICKER_KEYS) {
    assert.ok(en.plaza.notePicker[key], `en missing plaza.notePicker.${key}`);
    assert.ok(zh.plaza.notePicker[key], `zh missing plaza.notePicker.${key}`);
  }
});

test("chat background copy exists in both locales", () => {
  for (const key of BACKGROUND_KEYS) {
    assert.ok(en.chat.background[key], `en missing chat.background.${key}`);
    assert.ok(zh.chat.background[key], `zh missing chat.background.${key}`);
  }
});

test("select-note / chat-background screens contain no hardcoded CJK", () => {
  const cjk = /[一-鿿]/;
  for (const rel of [
    "src/features/social/screens/SelectNoteScreen.tsx",
    "src/features/chat/screens/ChatBackgroundScreen.tsx",
  ]) {
    assert.doesNotMatch(read(rel), cjk, `${rel} still has hardcoded CJK`);
  }
});

test("chat background no longer renders raw upload error message", () => {
  const src = read("src/features/chat/screens/ChatBackgroundScreen.tsx");
  // Friendly normalized copy, not the raw Error.message.
  assert.match(src, /t\('chat\.background\.failedBody'\)/);
  assert.doesNotMatch(src, /error instanceof Error \? error\.message/);
});
