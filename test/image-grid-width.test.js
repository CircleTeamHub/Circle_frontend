const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

test('ImageGrid accepts an optional containerWidth and falls back to default', () => {
  const src = read('src/features/discover/components/image-grid.tsx');
  assert.match(src, /containerWidth\?:\s*number/);
  // 入参优先，缺省退回按可用宽度算（实现用 containerWidthProp 避免变量遮蔽）。
  // 基准从视口宽换成了栏宽 —— 桌面网页版里内容待在 640 的居中栏里，
  // 按 1440 的视口算单图会溢出栏外（见 desktop-web-review-fixes）。
  assert.match(
    src,
    /containerWidthProp\s*\?\?\s*availableWidth - Spacing\.lg \* 2 - Spacing\.md \* 2/,
  );
});
