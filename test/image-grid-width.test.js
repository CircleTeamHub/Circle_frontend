const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

test('ImageGrid accepts an optional containerWidth and falls back to default', () => {
  const src = read('src/features/discover/components/image-grid.tsx');
  assert.match(src, /containerWidth\?:\s*number/);
  // 入参优先，缺省退回原算法（实现用 containerWidthProp 避免变量遮蔽）
  assert.match(
    src,
    /containerWidthProp\s*\?\?\s*screenWidth - Spacing\.lg \* 2 - Spacing\.md \* 2/,
  );
});
