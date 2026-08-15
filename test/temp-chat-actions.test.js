const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

test('create temp chat modal offers title, duration and member presets', () => {
  const src = read('src/features/messages/components/CreateTempChatModal.tsx');

  assert.match(src, /Modal/);
  assert.match(src, /onSubmit/);
  assert.match(src, /ttlMinutes/);
  assert.match(src, /maxMembers/);
  // 默认 3 天（4320 分钟）与 7 天硬顶（10080 分钟）的预设
  assert.match(src, /4320/);
  assert.match(src, /10080/);
  // 标题输入受 30 字符约束（与后端 DTO 对齐）
  assert.match(src, /maxLength=\{30\}/);
});

test('temp chat list screen opens the create modal and submits a payload', () => {
  const src = read('src/features/messages/screens/TempChatsScreen.tsx');

  assert.match(src, /CreateTempChatModal/);
  assert.match(src, /createTempChat/);
  assert.match(src, /handleCreateRoom/);
  assert.match(src, /creatingRoomRef/);
});

test('temp chat list screen exposes copy link + end via an inline more button', () => {
  const src = read('src/features/messages/screens/TempChatsScreen.tsx');
  // 行视图（含更多按钮）已抽到 TempChatRow，屏幕只负责编排动作。
  const row = read('src/features/messages/components/TempChatRow.tsx');

  assert.match(src, /endTempChat/);
  assert.match(src, /shareUrl/);
  assert.match(src, /t\('tempChats\.copyLink'\)/);
  assert.doesNotMatch(src, /Share\.share|\bShare,|tempChats\.shareMessage/);
  assert.match(row, /ellipsis-horizontal/);
  // 结束是破坏性操作，必须经过确认
  assert.match(src, /Alert\.alert/);
  assert.match(src, /destructive/);
});

test('temp chat link modal only displays and copies the link', () => {
  const src = read('src/features/messages/components/ShareTempChatModal.tsx');

  assert.match(src, /shareUrl/);
  assert.match(src, /expo-clipboard/);
  assert.match(src, /selectable/);
  assert.doesNotMatch(src, /react-native-qrcode-svg|QRCode|onShareSystem|share-outline/);
});

test('temp chat list screen opens the copy-link modal after create and from the row menu', () => {
  const src = read('src/features/messages/screens/TempChatsScreen.tsx');

  assert.match(src, /ShareTempChatModal/);
  assert.match(src, /shareTarget/);
});

test('temp chat routes preserve TEMP identity and preflight media before upload', () => {
  const tempChats = read('src/features/messages/screens/TempChatsScreen.tsx');
  const messages = read('src/features/messages/screens/MessagesScreen.tsx');
  const chatDetail = read('src/features/chat/screens/ChatDetailScreen.tsx');

  assert.match(tempChats, /conversationKind: 'temp'/);
  assert.match(messages, /conversationKind: dto\?\.type\.toLowerCase\(\)/);
  assert.match(chatDetail, /storedConversationType === 'TEMP'/);
  assert.match(chatDetail, /enabled: isGroupChat && !isTempChat/);
  assert.match(chatDetail, /assertMyTempChatConversationOpen\(conversationID\)/);
});
