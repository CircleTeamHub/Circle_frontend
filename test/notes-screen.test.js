const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('NotesScreen renders 我的笔记 title', () => {
  const src = read('src/features/notes/screens/NotesScreen.tsx');
  assert.match(src, /我的笔记/);
});

test('NotesScreen has search input placeholder', () => {
  const src = read('src/features/notes/screens/NotesScreen.tsx');
  assert.match(src, /输入你想搜索的内容/);
});

test('NotesScreen has 新建 button', () => {
  const src = read('src/features/notes/screens/NotesScreen.tsx');
  assert.match(src, /新建/);
});

test('NotesScreen has 已下架 filter button', () => {
  const src = read('src/features/notes/screens/NotesScreen.tsx');
  assert.match(src, /已下架/);
});

test('NotesScreen fetches notes and groups', () => {
  const src = read('src/features/notes/screens/NotesScreen.tsx');
  assert.match(src, /fetchNotes/);
  assert.match(src, /fetchNoteGroups/);
});

test('NotesScreen supports group management and multi-group filtering', () => {
  const src = read('src/features/notes/screens/NotesScreen.tsx');
  assert.match(src, /管理|ellipsis-horizontal/);
  assert.match(src, /note\.groups|n\.groups/);
  assert.match(src, /groups\.length === 0/);
  assert.match(src, /createNoteGroup/);
  assert.match(src, /updateNoteGroup/);
  assert.match(src, /deleteNoteGroup/);
  assert.match(src, /reorderNoteGroups/);
  assert.match(src, /PanResponder/);
  assert.match(src, /Animated\.Value|new Animated\.Value/);
});

test('EditNoteScreen loads and submits multiple group ids', () => {
  const src = read('src/features/notes/screens/EditNoteScreen.tsx');
  assert.match(src, /fetchNoteGroups/);
  assert.match(src, /selectedGroupIds|groupIds/);
  assert.match(src, /groupIds:/);
});

test('NoteCard renders title and meta', () => {
  const src = read('src/features/notes/components/NoteCard.tsx');
  assert.match(src, /note\.title/);
  assert.match(src, /buildNoteMeta/);
});

test('NoteCard has pin and edit actions', () => {
  const src = read('src/features/notes/components/NoteCard.tsx');
  assert.match(src, /onPinPress/);
  assert.match(src, /onEditPress/);
});

test('ProfileScreen navigates to notes on menu item press', () => {
  const src = read('src/features/profile/screens/ProfileScreen.tsx');
  assert.match(src, /profile\/notes/);
  assert.match(src, /handleMenuPress/);
});

test('ProfileScreen does not include the assistant menu item', () => {
  const src = read('src/features/profile/screens/ProfileScreen.tsx');
  assert.doesNotMatch(src, /profile\.assistant/);
});
