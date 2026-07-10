const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(__dirname, '..', rel));

test('plaza-post card message: extension + send into current conversation', () => {
  const client = read('src/im/client.ts');
  assert.match(client, /PLAZA_POST_CARD_EXTENSION = 'plaza-post-card-v1'/);
  // 只保留「发进当前会话」一条路径（报名→聊天待发卡片用）。
  assert.match(client, /export async function sendPlazaPostCardMessage/);
  // 通用「发到选中会话」的分享路径已撤掉。
  assert.doesNotMatch(client, /sendPlazaPostCardToConversation/);
});

test('mappers parse + preview + map the plaza-post card', () => {
  const mappers = read('src/im/mappers.ts');
  assert.match(mappers, /function parsePlazaPostCardPayload/);
  assert.match(mappers, /ext === PLAZA_POST_CARD_EXTENSION/);
  assert.match(mappers, /type: 'plaza-post-card'/);
  // 卡片封面走媒体地址归一化。
  assert.match(mappers, /coverUrl: normalizeMediaUrl\(payload\.coverUrl\)/);
});

test('bubble exists and is rendered + taps to post detail', () => {
  assert.equal(
    exists('src/features/chat/components/bubbles/plaza-post-card-bubble.tsx'),
    true,
  );
  const barrel = read('src/features/chat/components/chat-bubble.tsx');
  assert.match(barrel, /PlazaPostCardBubble/);
  const screen = read('src/features/chat/screens/ChatDetailScreen.tsx');
  assert.match(screen, /case 'plaza-post-card':/);
  assert.match(screen, /getPlazaPostDetailHref\(/);
});

test('pending-card store + chat consume + send card-then-text', () => {
  assert.equal(
    exists('src/features/chat/store/use-pending-chat-card-store.ts'),
    true,
  );
  const store = read('src/features/chat/store/use-pending-chat-card-store.ts');
  assert.match(store, /consumeFor/);
  assert.match(store, /conversationKey/);

  const screen = read('src/features/chat/screens/ChatDetailScreen.tsx');
  // 获焦按会话 key consume，并预填草稿（不覆盖非空）。
  assert.match(screen, /consumePendingChatCard\(sourceID\)/);
  assert.match(screen, /setDraft\(\(prev\) => prev \|\| cardPending\.draftText\)/);
  // 发送时先卡片后文字，空文字也能只发卡片。
  assert.match(screen, /sendPlazaPostCardMessage\(/);
  assert.match(screen, /\(!nextText && !pendingCard\)/);
});

test('signup → chat stages the post card + opener draft', () => {
  const screen = read('src/features/notifications/screens/PostSignupsScreen.tsx');
  assert.match(screen, /setPendingChatCard\(/);
  assert.match(screen, /conversationKey: signer\.userId/);
  assert.match(screen, /plaza\.signup\.chatOpener/);
  assert.match(screen, /toPlazaPostCardData\(/);
});

test('card has no general share entry — only the signup list creates it', () => {
  const detail = read('src/features/discover/screens/PlazaPostDetailScreen.tsx');
  // 帖子详情不再有「分享到聊天」入口。
  assert.doesNotMatch(detail, /shareToChat/);
  assert.doesNotMatch(detail, /forward-picker/);
  // 转发选择器也不再把 plaza-post-card 当可转发卡片。
  const picker = read('src/features/chat/screens/ForwardPickerScreen.tsx');
  assert.doesNotMatch(picker, /plaza-post-card/);
});

test('i18n keys present in zh + en', () => {
  const zh = JSON.parse(read('src/i18n/locales/zh.json'));
  const en = JSON.parse(read('src/i18n/locales/en.json'));
  for (const d of [zh, en]) {
    assert.ok(d.plaza.signup.chatOpener);
    assert.ok(d.plaza.postDetail.title);
    assert.ok(d.chat.plazaPostCard.footer);
    assert.ok(d.im.preview.plazaPost);
  }
});
