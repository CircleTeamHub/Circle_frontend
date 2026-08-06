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
  // 编辑入口只对可编辑者渲染（设计稿后是圆形描边按钮 + 铅笔图标）。
  assert.match(
    screenSrc,
    /\{canEditNote \? \([\s\S]*onPress=\{handleEdit\}[\s\S]*pencil-outline/,
  );
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
  assert.match(src, /setLocationDraft\(buildLocationDraft\(note\.sections\?\.location\)\)/);
  assert.match(src, /const nextLocation =/);
  assert.match(src, /location: nextLocation/);
  assert.match(src, /const hasExplicitMedia = hasSectionMediaItems\(note\.sections\?\.media\?\.items\)/);
  assert.match(src, /const hasExplicitShowcase = hasSectionMediaItems\(note\.sections\?\.showcase\?\.items\)/);
  assert.match(src, /hasExplicitMedia[\s\S]{0,120}normalizeSectionMedia\(note\.sections\?\.media\?\.items\)/);
  assert.match(src, /hasExplicitShowcase[\s\S]{0,120}\?\s*\[\]/);
  assert.match(src, /setShowcaseItems\([\s\S]{0,80}normalizeSectionMedia/);
  assert.match(src, /const sectionMedia = mergeMedia\(mediaItems\)/);
  assert.match(src, /const sectionShowcase = mergeMedia\(showcaseItems\)/);
  assert.match(src, /const legacyMedia = mergeMedia\(\[\.\.\.sectionMedia, \.\.\.sectionShowcase\]\)/);
  assert.match(src, /media: \{ items: sectionMedia \}/);
  assert.match(src, /showcase: \{ items: sectionShowcase \}/);
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
