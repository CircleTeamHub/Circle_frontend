const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('membership avatar frame assets exist (diamond + super)', () => {
  for (const name of ['diamond', 'super']) {
    const p = path.join(root, 'assets', 'frames', `${name}.png`);
    assert.ok(fs.existsSync(p), `missing assets/frames/${name}.png`);
    // 真 PNG 而不是空文件/占位。
    assert.ok(fs.statSync(p).size > 1000, `${name}.png suspiciously small`);
  }
});

test('membership-frames maps only diamond/super tiers to a frame', () => {
  const src = read('src/features/profile/membership-frames.ts');
  assert.match(src, /getMembershipTierForVipLevel/);
  assert.match(src, /diamond: require\([^)]*frames\/diamond\.png/);
  assert.match(src, /super: require\([^)]*frames\/super\.png/);
  assert.match(src, /tier === 'diamond' \|\| tier === 'super'/);
  assert.match(src, /export const AVATAR_FRAME_SCALE/);
});

test('Avatar reserves the scaled frame footprint so it does not overlap adjacent content', () => {
  const src = read('src/components/ui/avatar.tsx');
  assert.match(src, /frameSource\?: ImageSourcePropType/);
  // 方形头像(聊天列表)不套圆形框。
  assert.match(src, /shape !== 'circle'/);
  assert.match(src, /AVATAR_FRAME_SCALE/);
  assert.match(src, /pointerEvents="none"/);
  // 容器按框尺寸预留占位(钻石/超级框比头像大 1.6×),头像居中,框铺满——
  // 不再用负偏移把框溢出到 size×size 容器外、压住相邻的名字/会员卡片。
  assert.match(src, /width: frameSize, height: frameSize/);
  assert.doesNotMatch(src, /frameOffset/);
});

test('ProfileScreen and UserProfileScreen wear the membership frame', () => {
  const own = read('src/features/profile/screens/ProfileScreen.tsx');
  assert.match(own, /frameSource=\{getMembershipFrameAsset\(vipLevel\)/);

  const other = read('src/features/user/screens/UserProfileScreen.tsx');
  // 他人资料页直接使用公开 profile.vipLevel,并用框素材替代默认描边。
  assert.match(other, /profile\.vipLevel \?\? 0/);
  assert.doesNotMatch(other, /useUserVipLevel\(/);
  assert.match(other, /getMembershipFrameAsset\(profileVipLevel\)/);
  assert.match(other, /membershipFrameOverlay/);
  assert.match(other, /avatarRingFramed/);
});
