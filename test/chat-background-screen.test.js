const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

test('chat background screen lets users choose a custom image background', () => {
  const src = read('src/features/chat/screens/ChatBackgroundScreen.tsx');

  assert.match(src, /expo-image-picker/);
  assert.match(src, /handlePickCustomImage/);
  assert.match(src, /mode:\s*'image'/);
  // 背景图留在本机 —— 上传到 `chat/` 前缀存直链正是背景变灰的原因，
  // 断言见 test/chat-background-image.test.js。
  assert.match(src, /persistChatBackgroundImage/);
  assert.doesNotMatch(src, /图片背景稍后提供/);
});

test('chat background screen exposes the custom image option and a way back to default', () => {
  const src = read('src/features/chat/screens/ChatBackgroundScreen.tsx');

  assert.match(src, /label=\{t\('chat\.background\.customImage'\)\}/);
  assert.match(src, /rightText=\{customImageStatusText\}/);
  // 只有「选图」的话，设过一次就再也退不回默认：store 里清除背景的唯一入口是
  // 传一个 mode: 'global' 的偏好，界面上原本没有任何地方会那么做。
  assert.match(src, /chat\.background\.restoreDefault/);
  assert.match(src, /hasBackground \? \(/);
  assert.doesNotMatch(src, /CHAT_BACKGROUND_PRESETS/);
  assert.doesNotMatch(src, /DEFAULT_CHAT_BACKGROUND_PREFERENCE/);
  assert.doesNotMatch(src, /跟随全局/);
  assert.doesNotMatch(src, /晨雾蓝|森林绿|落日橙|薰衣草紫/);
  assert.doesNotMatch(src, /这是一条预览消息/);
});
