const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('会员头像框:紧凑系数在 1 与满溢(1.6)之间,带框头像只比普通略大', () => {
  const frames = read('src/features/profile/membership-frames.ts');
  const scale = Number(frames.match(/AVATAR_FRAME_SCALE\s*=\s*([\d.]+)/)?.[1]);
  const compact = Number(frames.match(/AVATAR_FRAME_COMPACT_SCALE\s*=\s*([\d.]+)/)?.[1]);
  assert.ok(scale > 1, 'AVATAR_FRAME_SCALE 应 > 1');
  assert.ok(
    compact > 1 && compact < scale,
    `紧凑系数 ${compact} 应在 (1, ${scale}) 之间:>1 才能容下框装饰,<${scale} 才比默认小`,
  );
});

test('Avatar 头像框:框在自身占位盒内铺满不裁切,支持紧凑模式(compactFrame)', () => {
  const avatar = read('src/components/ui/avatar.tsx');
  assert.match(avatar, /compactFrame/);
  assert.match(avatar, /AVATAR_FRAME_COMPACT_SCALE/);
  // 照片按框比例回推,正好落在框内孔里。
  assert.match(avatar, /const photoSize = hasFrame \? frameSize \/ AVATAR_FRAME_SCALE : size/);
  // 反例守卫:框必须在自身盒内 top/left:0 铺满,一旦改回负偏移(top: -…)会被卡片顶/屏幕边裁掉。
  assert.doesNotMatch(avatar, /top: -/);
});

test('聊天页气泡:头像改圆形、按会员档挂框,且用紧凑框(compactFrame)', () => {
  const received = read('src/features/chat/components/bubbles/received-bubble.tsx');
  const sent = read('src/features/chat/components/bubbles/sent-bubble.tsx');

  assert.match(received, /useUserVipLevel\(message\.senderID\)/);
  assert.match(received, /frameSource=\{getMembershipFrameAsset\(senderVipLevel\) \?\? undefined\}/);
  assert.match(received, /compactFrame/);

  assert.match(sent, /state\.user\?\.vipLevel \?\? 0/);
  assert.match(sent, /frameSource=\{getMembershipFrameAsset\(selfVipLevel\) \?\? undefined\}/);
  assert.match(sent, /compactFrame/);

  assert.doesNotMatch(received, /shape="square"/);
  assert.doesNotMatch(sent, /shape="square"/);
});

test('圈子动态页:作者头像按 author.vipLevel 挂框,且用紧凑框', () => {
  for (const rel of [
    'src/features/discover/components/moment-card.tsx',
    'src/features/discover/components/plaza-post-card.tsx',
    'src/features/discover/screens/MomentDetailScreen.tsx',
  ]) {
    const src = read(rel);
    assert.match(
      src,
      /frameSource=\{getMembershipFrameAsset\(post\.author\.vipLevel\) \?\? undefined\}/,
      `${rel} 应给作者头像挂 vipLevel 头像框`,
    );
    assert.match(src, /compactFrame/, `${rel} 头像框应用紧凑模式`);
  }
});

test('消息列表不展示头像框(用户明确要求)', () => {
  const messages = read('src/features/messages/screens/MessagesScreen.tsx');
  assert.doesNotMatch(messages, /frameSource/);
});
