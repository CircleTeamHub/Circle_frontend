const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

test('emoji constants expose grouped emojis', () => {
  const src = read('src/constants/emojis.ts');
  assert.match(src, /EMOJI_GROUPS/);
  // Category names moved to i18n: constants carry language-neutral labelKeys,
  // the picker renders t(`emojis.${labelKey}`). Chinese now lives in the locale JSON.
  assert.match(src, /labelKey: 'face'/);
  assert.match(src, /labelKey: 'gesture'/);
  assert.match(src, /😀/);
});

test('emoji picker renders groups and forwards the tapped emoji', () => {
  const src = read('src/features/chat/components/emoji-picker.tsx');
  assert.match(src, /EMOJI_GROUPS/);
  assert.match(src, /onSelect\(emoji\)/);
  assert.match(src, /accessibilityLabel=\{emoji\}/);
});

test('emoji picker explicitly uses the platform emoji font', () => {
  const src = read('src/features/chat/components/emoji-picker.tsx');
  assert.match(src, /Platform/);
  assert.match(src, /Apple Color Emoji/);
  assert.match(src, /Noto Color Emoji/);
  assert.match(src, /fontFamily:\s*emojiFontFamily/);
});
