const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 发热回归:聊天页原来十来个选择器各自在每次 chat store 写入时 find 整个会话数组。
// 群多时每个「正在输入」「在线」事件都是上千次比较。只允许按 id 查一次。
test('the chat detail hook looks the conversation up once per store write', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src/features/chat/chat-detail/hooks/use-chat-conversation.ts'),
    'utf8',
  );
  const lookups = source.match(/state\.conversations\.find\(/g) ?? [];
  assert.equal(lookups.length, 1, 'derive fields from the single conversation lookup');
  assert.match(source, /const conversation = useChatStore\(selectConversation\)/);
});
