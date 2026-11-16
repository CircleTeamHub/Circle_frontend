const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readSourceFile } = require('./helpers/chat-detail-source');

const read = (rel) => readSourceFile(rel);

test('GroupChatAvatar uses a scalable branded group illustration and optional clock / group badge', () => {
  const component = read('src/components/ui/group-chat-avatar.tsx');

  assert.match(component, /export function GroupChatAvatar/);
  assert.match(component, /const hasImage = Boolean\(imageUri && imageUri\.length > 0\)/);
  assert.match(component, /\{hasImage \? \(/);
  assert.match(component, /\{temporary \|\| showGroupBadge \? \(/);
  assert.match(component, /LinearGradient/);
  // 临时群:金色时钟;普通群(会话列表里):紫色「多人」,临时群优先。
  assert.match(component, /name=\{temporary \? 'time-outline' : 'people'\}/);
  assert.match(component, /badgeTemporary: \{ backgroundColor: '#FFC857' \}/);
  assert.match(component, /color=\{temporary \? '#5A3600' : '#FFFFFF'\}/);
  assert.match(component, /badgeGroup: \{ backgroundColor: '#7467F5' \}/);
  assert.match(component, /accessibilityRole="image"/);
  assert.match(component, /accessibilityLabel=\{name \|\| undefined\}/);
  assert.doesNotMatch(component, /require\(/);
});

test('all group conversation surfaces use the shared default avatar', () => {
  const surfaces = [
    'src/features/messages/screens/MessagesScreen.tsx',
    'src/features/messages/components/TempChatRow.tsx',
    'src/features/search/screens/SearchScreen.tsx',
    'src/features/chat/screens/ChatDetailScreen.tsx',
    'src/features/contacts/screens/GroupsScreen.tsx',
    // 转发 / 笔记分享 / 圈子名片分享共用「选择一个聊天」页,头像统一走 ChatTargetAvatar。
    'src/features/chat/components/chat-target-picker/ChatTargetAvatar.tsx',
    'src/features/messages/components/group-member-row.tsx',
  ];

  for (const rel of surfaces) {
    assert.match(read(rel), /GroupChatAvatar/, `${rel} 应使用 GroupChatAvatar`);
  }

  // 会话列表里群头像和单聊头像都是圆角方块:群聊必须带角标,否则设了头像的群和单聊分不出来。
  assert.match(
    read('src/features/messages/screens/MessagesScreen.tsx'),
    /<GroupChatAvatar[\s\S]{0,200}?temporary=\{item\.isTempChat\}\s+showGroupBadge/,
  );

  // 群聊和临时会话都走群头像(临时会话带时钟角标),只有单聊用人像。
  const targetAvatar = read(
    'src/features/chat/components/chat-target-picker/ChatTargetAvatar.tsx',
  );
  assert.match(targetAvatar, /if \(target\.kind === 'direct'\) \{\s*return <Avatar\b/);
  assert.match(targetAvatar, /temporary=\{target\.kind === 'temp'\}/);
  const targetTypes = read('src/features/chat/components/chat-target-picker/types.ts');
  assert.match(targetTypes, /kind: dto\.type === 'GROUP' \? 'group' : dto\.type === 'TEMP' \? 'temp' : 'direct'/);
  for (const rel of [
    'src/features/chat/components/chat-target-picker/ChatTargetRow.tsx',
    'src/features/chat/components/chat-target-picker/RecentForwardStrip.tsx',
  ]) {
    assert.match(read(rel), /<ChatTargetAvatar\b/, `${rel} 应使用 ChatTargetAvatar`);
  }
});
