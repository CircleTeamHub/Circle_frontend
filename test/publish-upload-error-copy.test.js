const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

// 发动态 / 发帖的上传失败文案曾经 `throw new Error(reason)` 跳进外层 catch，
// 被 getApiErrorMessage 的漏斗换成通用「发布失败」；超限图片还在逐图 catch 里
// 被当成 imageUpload 网络故障报进 Sentry。现在两种情况都就地 Alert 后 return。
const SCREENS = [
  'src/features/discover/screens/CreateMomentScreen.tsx',
  'src/features/social/screens/CreatePostScreen.tsx',
];

for (const file of SCREENS) {
  test(`${path.basename(file)} shows upload failure copy instead of throwing it into the error funnel`, () => {
    const src = read(file);

    assert.doesNotMatch(src, /throw new Error\(\s*reason\s*\)/);
    // validation.imageSizeLimit 是头像专用文案（「头像不能超过 10 MB」），与这里的 50MB 判据对不上。
    assert.doesNotMatch(src, /validation\.imageSizeLimit/);
    assert.match(src, /t\('upload\.errors\.fileTooLarge',\s*\{\s*maxMb: LIMITS\.IMAGE_MAX_SIZE_MB/);
    assert.match(src, /Alert\.alert\([^;]*,\s*reason,?\s*\);\s*return;/);

    // 超限是本地校验：在开始上传之前拦下，不进逐图 catch。
    const sizeCheck = src.indexOf('IMAGE_MAX_SIZE_MB');
    const upload = src.indexOf('mapWithConcurrency(');
    assert.ok(sizeCheck !== -1 && upload !== -1);
    assert.ok(sizeCheck < upload, 'image size check must run before uploads start');
  });
}
