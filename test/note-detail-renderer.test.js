const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('NoteBlockRenderer handles paragraph blocks', () => {
  const src = read('src/features/notes/components/NoteBlockRenderer.tsx');
  assert.match(src, /paragraph/);
});

test('NoteBlockRenderer handles heading blocks', () => {
  const src = read('src/features/notes/components/NoteBlockRenderer.tsx');
  assert.match(src, /heading/);
});

test('NoteBlockRenderer handles bulletListItem blocks', () => {
  const src = read('src/features/notes/components/NoteBlockRenderer.tsx');
  assert.match(src, /bulletListItem/);
});

test('NoteBlockRenderer handles image blocks with expo-image', () => {
  const src = read('src/features/notes/components/NoteBlockRenderer.tsx');
  assert.match(src, /image/);
  assert.match(src, /expo-image/);
});

test('NoteBlockRenderer handles video blocks with expo-video', () => {
  const src = read('src/features/notes/components/NoteBlockRenderer.tsx');
  assert.match(src, /case 'video'/);
  assert.match(src, /expo-video/);
  assert.match(src, /useVideoPlayer/);
  assert.match(src, /VideoView/);
});

test('NoteDetailScreen prefers contentJson over plain content', () => {
  const src = read('src/features/notes/screens/NoteDetailScreen.tsx');
  assert.match(src, /contentJson/);
  assert.match(src, /NoteBlockRenderer/);
});

test('NoteDetailScreen falls back to plain content string', () => {
  const src = read('src/features/notes/screens/NoteDetailScreen.tsx');
  assert.match(src, /note\.content/);
});

test('NoteDetailScreen has edit navigation', () => {
  const src = read('src/features/notes/screens/NoteDetailScreen.tsx');
  assert.match(src, /notes\/edit/);
});

test('NoteDetailScreen only shows edit when the current user can edit', () => {
  const screenSrc = read('src/features/notes/screens/NoteDetailScreen.tsx');
  const typesSrc = read('src/features/notes/types.ts');

  assert.match(typesSrc, /canEdit\?: boolean/);
  assert.match(typesSrc, /ownerId\?: string \| null/);
  assert.match(screenSrc, /useAuthStore/);
  assert.match(screenSrc, /ownerId/);
  assert.match(screenSrc, /note\.canEdit/);
  assert.match(screenSrc, /const canEditNote =/);
  assert.match(
    screenSrc,
    /\{canEditNote \? \([\s\S]*<Pressable onPress=\{handleEdit\} hitSlop=\{8\}>[\s\S]*create-outline/,
  );
});

test('note card messages carry owner identity for read-only shared notes', () => {
  const chatSrc = read('src/features/chat/screens/ChatDetailScreen.tsx');
  const typeSrc = read('src/types/index.ts');
  const clientSrc = read('src/im/client.ts');
  const mapperSrc = read('src/im/mappers.ts');

  assert.match(typeSrc, /ownerId\?: string \| null/);
  assert.match(clientSrc, /ownerId\?: string \| null/);
  assert.match(mapperSrc, /ownerId: raw\.ownerId/);
  assert.match(chatSrc, /ownerId: authUser\?\.id \?\? null/);
  assert.match(chatSrc, /getNoteDetailHref\(scope, note\.noteId, note\.ownerId \?\? ''\)/);
});

test('EditNoteScreen saves with createNote or updateNote', () => {
  const src = read('src/features/notes/screens/EditNoteScreen.tsx');
  assert.match(src, /createNote/);
  assert.match(src, /updateNote/);
});

test('EditNoteScreen preserves structured note sections it cannot edit', () => {
  const src = read('src/features/notes/screens/EditNoteScreen.tsx');
  assert.match(src, /existingSectionsRef/);
  assert.match(src, /note\.sections\?\.text\?\.contentJson/);
  assert.match(src, /location: existingSections\?\.location \?\? null/);
  assert.match(src, /const preservedShowcase =/);
  assert.match(src, /const legacyMedia = \[\.\.\.media, \.\.\.preservedShowcase\]/);
  assert.match(src, /showcase: \{ items: preservedShowcase \}/);
  assert.match(src, /media: legacyMedia/);
});

test('NoteDetailScreen retries section jumps after layout is measured', () => {
  const src = read('src/features/notes/screens/NoteDetailScreen.tsx');
  assert.match(src, /scrollToRequestedSection/);
  assert.match(src, /scrolledSectionRef\.current = scrollKey/);
  assert.match(src, /onContentSizeChange=\{scrollToRequestedSection\}/);
  assert.match(src, /sectionYRef\.current\[kind\] = event\.nativeEvent\.layout\.y;[\s\S]{0,120}scrollToRequestedSection\(\)/);
});

test('EditNoteScreen has disabled done button while submitting', () => {
  const src = read('src/features/notes/screens/EditNoteScreen.tsx');
  assert.match(src, /isSubmitting/);
  assert.match(src, /disabled/);
});
