const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

test('useChangeCover picks an image, uploads to covers folder and patches profile', () => {
  const src = read('src/features/discover/hooks/use-change-cover.ts');
  assert.match(src, /export function useChangeCover/);
  // 选图（沿用 profile 的图片选择器）
  assert.match(src, /loadImagePickerModule/);
  assert.match(src, /launchImageLibraryAsync/);
  // 上传到 covers 文件夹
  assert.match(src, /requestUploadPresign/);
  assert.match(src, /folder:\s*'covers'/);
  assert.match(src, /uploadLocalFileToPresignedUrl/);
  // 更新封面字段 + 回写全局用户
  assert.match(src, /updateUserProfile/);
  assert.match(src, /cover:/);
  assert.match(src, /setUser/);
  // loading 态
  assert.match(src, /changing/);
});
