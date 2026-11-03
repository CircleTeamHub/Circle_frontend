const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

const { EMOJI_GROUPS } = loadTsModule('src/constants/emojis.ts');
const emojis = Array.from(EMOJI_GROUPS).flatMap((group) => Array.from(group.emojis));

test('the shared chat and reaction palette contains every legacy reaction without duplicate cells', () => {
  assert.equal(new Set(emojis).size, emojis.length);
  for (const emoji of ['👍', '❤️', '😂', '😮', '😢', '🙏']) assert.ok(emojis.includes(emoji));
});

test('chat reactions use the full grouped picker and the existing send handler', () => {
  const screen = fs.readFileSync('src/features/chat/screens/ChatDetailScreen.tsx', 'utf8');
  const sheet = fs.readFileSync('src/features/chat/components/reaction-picker-sheet.tsx', 'utf8');
  assert.match(screen, /<ReactionPickerSheet[\s\S]*?onSelect=\{handlePickReaction\}/);
  assert.match(sheet, /<EmojiPicker onSelect=\{onSelect\}/);
  assert.doesNotMatch(screen, /reactionOptions/);
});

const backendConstants = path.join(
  process.env.BACKEND_CONTRACTS_DIR ?? path.resolve('..', 'circle_be'),
  'src/chat/chat.constants.ts',
);

test('the backend accepts the full picker palette and every emoji fits the stored field', {
  skip: !fs.existsSync(backendConstants) && 'Backend contract sources not available',
}, () => {
  const { CHAT_REACTION_EMOJIS } = loadTsModule(path.relative(process.cwd(), backendConstants));
  assert.deepEqual([...CHAT_REACTION_EMOJIS].sort(), [...emojis].sort());
  assert.ok(emojis.every((emoji) => Array.from(emoji).length <= 16));
});
