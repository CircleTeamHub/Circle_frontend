const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

test('default cover gradient is a design token, exported from theme', () => {
  const tokens = read('src/theme/tokens.ts');
  assert.match(tokens, /export const Gradients/);
  assert.match(tokens, /defaultCover:\s*\[/);
  // 3-stop 紫蓝对角渐变
  assert.match(tokens, /#6E7BF0/);
  assert.match(tokens, /#DBAAEF/);

  const index = read('src/theme/index.ts');
  assert.match(index, /Gradients/);
});

test('GradientCover fills its parent via react-native-svg (no new native dep)', () => {
  const comp = read('src/components/ui/gradient-cover.tsx');
  assert.match(comp, /export function GradientCover/);
  // 复用已安装的 react-native-svg，而不是新增 expo-linear-gradient
  assert.match(comp, /from 'react-native-svg'/);
  assert.match(comp, /LinearGradient/);
  assert.match(comp, /Stop/);
  assert.match(comp, /Rect/);
  // 默认取品牌 token
  assert.match(comp, /Gradients\.defaultCover/);
  // 同屏多个封面时 id 唯一，避免 svg 冲突
  assert.match(comp, /useId\(\)/);
  // 铺满父容器
  assert.match(comp, /absoluteFill/);

  // 没有引入 expo-linear-gradient 依赖
  const pkg = read('package.json');
  assert.doesNotMatch(pkg, /expo-linear-gradient/);
});

test('朋友圈封面：无封面时回落到默认渐变', () => {
  const header = read('src/features/discover/components/moment-album-header.tsx');
  assert.match(header, /import \{ GradientCover \}/);
  assert.match(header, /<GradientCover \/>/);
  // 旧的纯灰占位已移除
  assert.doesNotMatch(header, /coverPlaceholder/);
});

test('圈子封面：无封面时回落到默认渐变', () => {
  const screen = read(
    'src/features/discover/screens/CircleDetailScreen.tsx',
  );
  assert.match(screen, /import \{ GradientCover \}/);
  assert.match(screen, /<GradientCover \/>/);
  // 旧的纯色 + image-outline 占位已移除
  assert.doesNotMatch(screen, /coverPlaceholder/);
});
