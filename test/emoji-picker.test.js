const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

test('emoji constants expose grouped emojis', () => {
  const src = read('src/constants/emojis.ts');
  assert.match(src, /EMOJI_GROUPS/);
  assert.match(src, /'表情'/);
  assert.match(src, /'手势'/);
  assert.match(src, /😀/);
});

test('emoji picker renders groups and forwards the tapped emoji', () => {
  const src = read('src/features/chat/components/emoji-picker.tsx');
  assert.match(src, /EMOJI_GROUPS/);
  assert.match(src, /onSelect\(emoji\)/);
  assert.match(src, /accessibilityLabel=\{emoji\}/);
});
