const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

test('share-post route re-exports the share screen', () => {
  assert.match(
    read('app/(tabs)/discover/share-post.tsx'),
    /SharePlazaPostScreen/,
  );
});

test('SharePlazaPostScreen sends the post as a chat card to the picked friend', () => {
  const src = read(
    'src/features/discover/screens/SharePlazaPostScreen.tsx',
  );
  // 选好友 → 把帖子压成聊天卡片，预挂到该会话，再解析会话并进入聊天页发送。
  assert.match(src, /toPlazaPostCardData/);
  assert.match(src, /setPendingChatCard\(/);
  assert.match(src, /conversationKey: friend\.id/);
  assert.match(src, /getOrCreateSingleConversation\(friend\.id\)/);
  assert.match(src, /getChatDetailHref\(/);
});

test('plaza post card share opens the friend picker, not the OS share sheet', () => {
  const src = read(
    'src/features/discover/components/plaza-post-card.tsx',
  );
  assert.match(src, /pathname: '\/\(tabs\)\/discover\/share-post'/);
  assert.doesNotMatch(src, /Share\.share/);
});
