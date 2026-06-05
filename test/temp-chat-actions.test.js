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

test('temp chat list screen exposes share + end via an inline more button', () => {
  const src = read('src/features/messages/screens/TempChatsScreen.tsx');
  // 行视图（含更多按钮）已抽到 TempChatRow，屏幕只负责编排动作。
  const row = read('src/features/messages/components/TempChatRow.tsx');

  assert.match(src, /endTempChat/);
  assert.match(src, /Share/);
  assert.match(src, /shareUrl/);
  assert.match(row, /ellipsis-horizontal/);
  // 结束是破坏性操作，必须经过确认
  assert.match(src, /Alert\.alert/);
  assert.match(src, /destructive/);
});

test('share temp chat modal renders a QR code with copy + system share', () => {
  const src = read('src/features/messages/components/ShareTempChatModal.tsx');

  assert.match(src, /react-native-qrcode-svg/);
  assert.match(src, /QRCode/);
  assert.match(src, /shareUrl/);
  // 一键复制走系统剪贴板
  assert.match(src, /expo-clipboard/);
  // 系统分享入口由外部注入
  assert.match(src, /onShareSystem/);
});

test('temp chat list screen opens the QR share modal after create and from the row menu', () => {
  const src = read('src/features/messages/screens/TempChatsScreen.tsx');

  assert.match(src, /ShareTempChatModal/);
  assert.match(src, /shareTarget/);
});
