const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(process.cwd(), rel));

test('post form store keeps the selected note until post submit resets the form', () => {
  const src = read('src/features/discover/store/use-post-form-store.ts');

  assert.match(src, /selectedNote/);
  assert.match(src, /setSelectedNote/);
  assert.match(src, /reset:\s*\(\)\s*=>\s*set\(\{[\s\S]*selectedNote:\s*null/);
});

test('create post screen routes to note picker and submits the selected note id', () => {
  const src = read('src/features/social/screens/CreatePostScreen.tsx');

  assert.match(src, /selectedNote/);
  assert.match(src, /handleSelectNote/);
  assert.match(src, /select-note/);
  assert.match(src, /rightText=\{[\s\S]*selectedNote\?\.title/);
  assert.match(src, /noteId:\s*selectedNote\?\.id\s*\?\?\s*null/);
  assert.doesNotMatch(src, /notePickerComingSoon/);
});

test('select note screen loads active notes and stores the chosen note for the post composer', () => {
  const src = read('src/features/social/screens/SelectNoteScreen.tsx');

  assert.match(src, /fetchNotes\(\{ status: 'ACTIVE'/);
  assert.match(src, /setSelectedNote/);
  assert.match(src, /router\.back\(\)/);
  assert.match(src, /t\('plaza\.notePicker\.searchPlaceholder'\)/);
  assert.match(src, /t\('plaza\.notePicker\.none'\)/);
});

test('discover post flow exports a select-note route', () => {
  assert.equal(exists('app/(tabs)/discover/select-note.tsx'), true);
  const route = read('app/(tabs)/discover/select-note.tsx');
  assert.match(route, /SelectNoteScreen/);
});
