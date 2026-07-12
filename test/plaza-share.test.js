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

test('share plaza post only stages the card after resolving a destination', () => {
  const src = read('src/features/discover/screens/SharePlazaPostScreen.tsx');
  const handler = src.slice(src.indexOf('const handleSelect'), src.indexOf('const renderFriend'));
  const resolution = handler.indexOf('await getOrCreateSingleConversation');
  const normalStage = handler.indexOf('setPendingChatCard', resolution);
  const normalNavigation = handler.indexOf('router.push', normalStage);
  const fallback = handler.indexOf('if (shouldOpenChatPreview');
  const fallbackStage = handler.indexOf('setPendingChatCard', fallback);
  const fallbackNavigation = handler.indexOf('router.push', fallbackStage);

  assert.equal(normalStage > resolution && normalStage < normalNavigation, true);
  assert.equal(handler.slice(0, resolution).includes('setPendingChatCard'), false);
  assert.equal(fallbackStage > fallback && fallbackStage < fallbackNavigation, true);
});
