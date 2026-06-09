const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

test('chat background screen lets users choose and upload a custom image background', () => {
  const src = read('src/features/chat/screens/ChatBackgroundScreen.tsx');

  assert.match(src, /expo-image-picker/);
  assert.match(src, /requestUploadPresign/);
  assert.match(src, /uploadLocalFileToPresignedUrl/);
  assert.match(src, /folder:\s*'chat'/);
  assert.match(src, /handlePickCustomImage/);
  assert.match(src, /mode:\s*'image'/);
  assert.match(src, /uri:\s*presign\.fileUrl/);
  assert.doesNotMatch(src, /图片背景稍后提供/);
});

test('chat background screen only exposes the custom image background option', () => {
  const src = read('src/features/chat/screens/ChatBackgroundScreen.tsx');

  assert.match(src, /label="自定义图片"/);
  assert.match(src, /rightText=\{customImageStatusText\}/);
  assert.doesNotMatch(src, /CHAT_BACKGROUND_PRESETS/);
  assert.doesNotMatch(src, /DEFAULT_CHAT_BACKGROUND_PREFERENCE/);
  assert.doesNotMatch(src, /跟随全局/);
  assert.doesNotMatch(src, /晨雾蓝|森林绿|落日橙|薰衣草紫/);
  assert.doesNotMatch(src, /这是一条预览消息/);
});
