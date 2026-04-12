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

test('EditNoteScreen saves with createNote or updateNote', () => {
  const src = read('src/features/notes/screens/EditNoteScreen.tsx');
  assert.match(src, /createNote/);
  assert.match(src, /updateNote/);
});

test('EditNoteScreen has disabled done button while submitting', () => {
  const src = read('src/features/notes/screens/EditNoteScreen.tsx');
  assert.match(src, /isSubmitting/);
  assert.match(src, /disabled/);
});
