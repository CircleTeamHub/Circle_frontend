const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('UserIconRow 把 VIP/新人/合作达人统一渲染成同尺寸图形徽章，圈子图标走圆形容器', () => {
  const row = read('src/components/ui/user-icon-row.tsx');

  assert.match(row, /export function UserIconBadge/);
  assert.match(row, /formatIconLabel/);
  assert.match(row, /compactCircle/);
  assert.match(row, /numberOfLines=\{1\}/);
  assert.match(row, /tone\s*=\s*'default'/);
  // VIP / 新人 / 合作达人三个系统徽章统一走 SystemIconArt 图形，尺寸一致
  assert.match(row, /isVip \|\| isNewUser \|\| isPartner/);
  assert.match(row, /SystemIconArt/);
  assert.match(row, /systemKey=\{graphicKey\}/);
  // VIP 把等级数字透传给图标
  assert.match(row, /level=\{vipLevel\}/);
  // 圈子徽章仍用圆形容器装图片 / fallback
  assert.match(row, /s\.circle/);
  assert.match(row, /resolveFallbackIcon/);
  assert.match(row, /function buildIconKey/);
  assert.match(row, /function isRenderableIcon/);
});
