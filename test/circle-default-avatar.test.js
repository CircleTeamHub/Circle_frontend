const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

test('CircleAvatar: 有图显示图，无图回落到品牌渐变默认头像', () => {
  const comp = read('src/components/ui/circle-avatar.tsx');
  assert.match(comp, /export function CircleAvatar/);
  // uri 存在 → expo-image
  assert.match(comp, /from 'expo-image'/);
  // 无 uri → 渐变底 + people 字形（复用封面同款 GradientCover）
  assert.match(comp, /GradientCover/);
  assert.match(comp, /name="people"/);
  // 不依赖任何图片资源文件 / svg-transformer
  assert.doesNotMatch(comp, /require\(/);
});

test('圈子默认头像：所有圈子头像渲染点都走 CircleAvatar', () => {
  const surfaces = [
    'src/features/discover/screens/CircleDetailScreen.tsx',
    'src/features/discover/components/my-circles-panel.tsx',
    'src/features/chat/components/chat-bubble.tsx',
    'src/features/discover/screens/SelectCircleScreen.tsx',
    'src/features/discover/screens/SelectFilterCirclesScreen.tsx',
  ];
  for (const rel of surfaces) {
    const src = read(rel);
    assert.match(src, /CircleAvatar/, `${rel} 应使用 CircleAvatar`);
  }

  const myCirclesPanel = read(
    'src/features/discover/components/my-circles-panel.tsx',
  );
  assert.match(
    myCirclesPanel,
    /import \{ CircleAvatar \} from ['"]@\/components\/ui\/circle-avatar['"]/,
  );
});

test('圈子详情页：旧的 people 占位 / avatarPlaceholder 已移除', () => {
  const screen = read(
    'src/features/discover/screens/CircleDetailScreen.tsx',
  );
  assert.doesNotMatch(screen, /avatarPlaceholder/);
});

test('圈子列表：不再用裸 <Image source uri avatarUrl> 渲染圈子头像', () => {
  for (const rel of [
    'src/features/discover/screens/SelectCircleScreen.tsx',
    'src/features/discover/screens/SelectFilterCirclesScreen.tsx',
    'src/features/discover/components/my-circles-panel.tsx',
  ]) {
    const src = read(rel);
    assert.doesNotMatch(
      src,
      /source=\{\{\s*uri:\s*item\.avatarUrl/,
      `${rel} 不应再用裸 Image 渲染圈子头像`,
    );
  }
});
