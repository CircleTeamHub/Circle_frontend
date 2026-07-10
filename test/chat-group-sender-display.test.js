const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('group chat bubbles show sender name (remark first) above received messages', () => {
  const screen = read('src/features/chat/screens/ChatDetailScreen.tsx');

  // 名字标签：仅群聊 + 接收消息（senderID 只在接收消息上存在）。
  assert.match(screen, /withGroupSenderLabel/);
  assert.match(screen, /if \(!isGroupChat \|\| !message\.senderID\)/);
  // 显示名优先级：本地备注 > 消息昵称 > 会话标题。
  assert.match(
    screen,
    /override\?\.remark \|\| msg\.senderName \|\| conversationTitle/,
  );
  // 名字标签对所有走 withMessageActions 的气泡类型生效。
  assert.match(screen, /\{withGroupSenderLabel\(message, node\)\}/);
});

test('group chat avatars come from the sender, not the conversation param', () => {
  const screen = read('src/features/chat/screens/ChatDetailScreen.tsx');
  const mappers = read('src/im/mappers.ts');
  const types = read('src/types/index.ts');

  // 群聊头像 = 发送者本人（senderFaceUrl，随新消息更新）；单聊沿用会话头像。
  assert.match(
    screen,
    /isGroupChat \? msg\.senderAvatarUrl : \(avatarUrl \?\? msg\.senderAvatarUrl\)/,
  );
  // 不允许再把会话头像参数直接塞给接收气泡。
  assert.doesNotMatch(screen, /senderAvatarUri=\{avatarUrl\}/);
  assert.match(screen, /senderAvatarUri=\{receivedAvatarUri\(item\)\}/);
  // 消息映射带出发送者头像（仅接收侧），并做媒体地址归一化。
  assert.match(
    mappers,
    /senderAvatarUrl: isSent\s*\?\s*undefined\s*:\s*\(normalizeMediaUrl\(item\.senderFaceUrl \|\| null\) \?\? undefined\)/,
  );
  assert.match(types, /senderAvatarUrl\?: string/);
});
