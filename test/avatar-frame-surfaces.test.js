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

test('个人页顶部头像使用当前装备外观,管理员框与移除状态都不回退会员框', () => {
  const profile = read('src/features/profile/screens/ProfileScreen.tsx');
  assert.match(
    profile,
    /<Avatar[\s\S]*?size=\{56\}[\s\S]*?compactFrame[\s\S]*?frameSource=\{getAvatarFrameSource\(user\?\.avatarFrameAppearance\) \?\? undefined\}[\s\S]*?\/>/,
  );
  assert.match(profile, /import \{ getAvatarFrameSource \}/);
  assert.doesNotMatch(profile, /getMembershipFrameAsset/);
});

test('聊天页气泡:头像统一走 shared 的 MessageAvatar,接收方批量外观、发送方认证用户外观', () => {
  // 头像框原来只挂在 sent/received 两个文字气泡上,其余 10 种(图片/语音/位置/
  // 通话记录 + 六种卡片)各自 `<Avatar shape="square" />` 不带框 —— 同一个人
  // 发文字是圆形带框、发卡片就变方形无框。现在收敛成 shared 里唯一一个
  // MessageAvatar,这条用例守住「没人再自己画发送者头像」。
  const shared = read('src/features/chat/components/bubbles/shared.tsx');

  assert.match(shared, /useUserAppearance\(/);
  assert.match(shared, /useAuthStore\(\(state\) => state\.user\?\.avatarFrameAppearance\)/);
  assert.match(shared, /frameSource=\{getAvatarFrameSource\(frame\) \?\? undefined\}/);
  assert.match(shared, /compactFrame/);
  assert.doesNotMatch(shared, /useUserVipLevel|getMembershipFrameAsset|vipLevel/);
  assert.doesNotMatch(shared, /shape="square"/);

  // 每个气泡都用共用组件,并且不再自己 import Avatar 画发送者头像。
  const bubbles = [
    'sent-bubble',
    'received-bubble',
    'note-card-bubble',
    'friend-card-bubble',
    'circle-card-bubble',
    'transfer-card-bubble',
    'verification-card-bubble',
    'plaza-post-card-bubble',
    'image-bubble',
    'voice-bubble',
    'location-card',
    'call-record-bubble',
  ];
  for (const name of bubbles) {
    const source = read(`src/features/chat/components/bubbles/${name}.tsx`);
    assert.match(source, /<MessageAvatar/, `${name} 没走共用头像`);
    assert.doesNotMatch(
      source,
      /frameSource=/,
      `${name} 不该自己拼头像框,交给 MessageAvatar`,
    );
  }

  // 名片卡里那颗 48pt 的「被推荐好友」头像是卡片内容,不是发送者,保留直用 Avatar。
  const friendCard = read('src/features/chat/components/bubbles/friend-card-bubble.tsx');
  assert.match(friendCard, /size=\{48\}/);
});

test('圈子动态页:内联作者资料直接决定头像框,支持管理员远程框、会员内置框与显式无框', () => {
  for (const rel of [
    'src/features/discover/components/moment-card.tsx',
    'src/features/discover/components/plaza-post-card.tsx',
    'src/features/discover/screens/MomentDetailScreen.tsx',
  ]) {
    const src = read(rel);
    assert.match(
      src,
      /frameSource=\{getAvatarFrameSource\(post\.author\.avatarFrameAppearance\) \?\? undefined\}/,
      `${rel} 应直接解析后端内联的有效头像框`,
    );
    assert.match(src, /compactFrame/, `${rel} 头像框应用紧凑模式`);
    assert.doesNotMatch(
      src,
      /getMembershipFrameAsset/,
      `${rel} 不得从 vipLevel 派生头像框`,
    );
  }
});

test('他人资料页使用公开资料的有效头像框并保留原头像框占位布局', () => {
  const profile = read('src/features/user/screens/UserProfileScreen.tsx');
  assert.match(
    profile,
    /const membershipFrame = getAvatarFrameSource\(profile\.avatarFrameAppearance\);/,
  );
  assert.match(profile, /membershipFrameOverlay/);
  assert.match(profile, /avatarRingFramed/);
  assert.doesNotMatch(profile, /getMembershipFrameAsset/);
});

test('所有实际头像框表面都不再调用旧 VIP resolver', () => {
  for (const rel of [
    'src/features/profile/screens/ProfileScreen.tsx',
    'src/features/user/screens/UserProfileScreen.tsx',
    'src/features/chat/components/bubbles/received-bubble.tsx',
    'src/features/chat/components/bubbles/sent-bubble.tsx',
    'src/features/discover/components/moment-card.tsx',
    'src/features/discover/components/plaza-post-card.tsx',
    'src/features/discover/screens/MomentDetailScreen.tsx',
  ]) {
    assert.doesNotMatch(
      read(rel),
      /getMembershipFrameAsset/,
      `${rel} 仍在调用旧 VIP resolver`,
    );
  }
});

test('消息列表不展示头像框(用户明确要求)', () => {
  const messages = read('src/features/messages/screens/MessagesScreen.tsx');
  assert.doesNotMatch(messages, /frameSource/);
});
