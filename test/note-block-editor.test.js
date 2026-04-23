const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test("NoteBlockEditor.dom.tsx has 'use dom' directive", () => {
  const src = read('src/features/notes/dom/NoteBlockEditor.dom.tsx');
  assert.match(src, /'use dom'/);
});

test('NoteBlockEditor.dom.tsx imports BlockNote React', () => {
  const src = read('src/features/notes/dom/NoteBlockEditor.dom.tsx');
  assert.match(src, /@blocknote\/react/);
});

test('NoteBlockEditor.dom.tsx has onContentChange callback', () => {
  const src = read('src/features/notes/dom/NoteBlockEditor.dom.tsx');
  assert.match(src, /onContentChange/);
});

test('NoteBlockEditor.dom.tsx has onImageRequest callback', () => {
  const src = read('src/features/notes/dom/NoteBlockEditor.dom.tsx');
  assert.match(src, /onImageRequest/);
});

test('NoteBlockEditor.dom.tsx handles pendingInsert to insert image block', () => {
  const src = read('src/features/notes/dom/NoteBlockEditor.dom.tsx');
  assert.match(src, /pendingInsert/);
  assert.match(src, /insertBlocks/);
});

test('Native NoteBlockEditor.tsx uses expo-image-picker', () => {
  const src = read('src/features/notes/components/NoteBlockEditor.tsx');
  assert.match(src, /ImagePicker/);
  assert.match(src, /pendingInsert/);
});

test('Native NoteBlockEditor.tsx uploads via presign', () => {
  const src = read('src/features/notes/components/NoteBlockEditor.tsx');
  assert.match(src, /requestUploadPresign/);
  assert.match(src, /notes/);
});
