const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

test('MessageActionMenu is an anchored floating menu (Modal + absolute position)', () => {
  const src = read('src/features/chat/components/MessageActionMenu.tsx');
  assert.match(src, /Modal/);
  assert.match(src, /position: 'absolute'/);
  // positions relative to the long-press point, flipping above/below
  assert.match(src, /anchor\.y/);
  assert.match(src, /placeAbove/);
  assert.match(src, /onDismiss/);
});

test('MessageActionMenu keeps message actions in a compact grid instead of a tall sheet', () => {
  const src = read('src/features/chat/components/MessageActionMenu.tsx');
  assert.match(src, /COMPACT_GRID_THRESHOLD = 5/);
  assert.match(src, /GRID_COLUMNS = 4/);
  assert.match(src, /gridRows/);
  assert.match(src, /menuGrid/);
  assert.doesNotMatch(src, /actions\.length > 4/);
  assert.doesNotMatch(src, /actions\.length \* VERTICAL_ITEM_HEIGHT/);
});

test('ChatDetailScreen long-press opens the anchored menu instead of an Alert', () => {
  const src = read('src/features/chat/screens/ChatDetailScreen.tsx');
  // long-press captures the touch point and opens the floating menu
  assert.match(src, /setActionMenu\(\{ message, x: pageX, y: pageY \}\)/);
  assert.match(src, /<MessageActionMenu/);
  assert.match(src, /actions=\{messageActions\}/);
  // copy / forward / collect actions are offered, while the save action is removed.
  assert.match(src, /key: 'copy'/);
  assert.match(src, /key: 'forward'/);
  assert.match(src, /key: 'collect'/);
  assert.doesNotMatch(src, /key: 'save'/);
  assert.doesNotMatch(src, /handleSaveMessage/);
});

test('ChatDetailScreen wires long-press handlers into non-text message bubbles', () => {
  const src = read('src/features/chat/screens/ChatDetailScreen.tsx');
  assert.match(src, /getMessageLongPressHandler/);
  for (const component of [
    'LocationCard',
    'ImageBubble',
    'VoiceBubble',
    'NoteCardBubble',
    'FriendCardBubble',
    'CircleCardBubble',
    'TransferCardBubble',
  ]) {
    assert.match(
      src,
      new RegExp(`<${component}[\\s\\S]*onLongPress=\\{getMessageLongPressHandler\\(item\\)\\}`),
      `${component} should receive the message long-press handler`,
    );
  }
  const verificationCase =
    src.match(/case 'verification-card':[\s\S]*?case 'transfer-card':/)?.[0] ?? '';
  assert.match(verificationCase, /<VerificationCardBubble/);
  assert.doesNotMatch(verificationCase, /withMessageActions/);
  assert.doesNotMatch(verificationCase, /onLongPress=/);
});

test('non-text chat bubbles pass long-press through their internal Pressables', () => {
  for (const rel of [
    'src/features/chat/components/bubbles/image-bubble.tsx',
    'src/features/chat/components/bubbles/voice-bubble.tsx',
    'src/features/chat/components/bubbles/location-card.tsx',
    'src/features/chat/components/bubbles/friend-card-bubble.tsx',
    'src/features/chat/components/bubbles/note-card-bubble.tsx',
    'src/features/chat/components/bubbles/transfer-card-bubble.tsx',
    'src/features/chat/components/bubbles/shared.tsx',
  ]) {
    const src = read(rel);
    assert.match(src, /onLongPress\?:/, `${rel} should expose an onLongPress prop`);
    assert.match(src, /onLongPress=\{onLongPress\}/, `${rel} should pass onLongPress to Pressable`);
  }
});
