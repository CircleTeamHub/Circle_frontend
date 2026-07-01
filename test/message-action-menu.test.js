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

test('MessageActionMenu keeps seven actions in a compact grid instead of a tall sheet', () => {
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
  // copy / forward / collect actions are offered
  assert.match(src, /key: 'copy'/);
  assert.match(src, /key: 'forward'/);
  assert.match(src, /key: 'collect'/);
});
