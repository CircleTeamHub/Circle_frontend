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

test('NotesScreen keeps group management sheet interactions inside a non-pressable card', () => {
  const src = read('src/features/notes/screens/NotesScreen.tsx');
  assert.match(src, /<View style=\{\[s\.modalCard, d\.modalCard\]\}>/);
  assert.doesNotMatch(src, /<Pressable style=\{\[s\.modalCard, d\.modalCard\]\}/);
});

test('NotesScreen keeps the group manager backdrop behind the editor controls', () => {
  const src = read('src/features/notes/screens/NotesScreen.tsx');
  assert.match(src, /<View style=\{\[s\.modalOverlay, d\.modalOverlay\]\} pointerEvents="box-none">/);
  assert.match(src, /modalBackdrop:\s*{[\s\S]*zIndex:\s*0/);
  assert.match(src, /modalCard:\s*{[\s\S]*zIndex:\s*1/);
  assert.match(src, /modalCard:\s*{[\s\S]*elevation:\s*1/);
});

test('NotesScreen keeps the add group button pressable and focuses the input for empty names', () => {
  const src = read('src/features/notes/screens/NotesScreen.tsx');
  assert.match(src, /groupNameInputRef/);
  assert.match(src, /handleSubmitGroupPress/);
  assert.match(src, /onPress=\{handleSubmitGroupPress\}/);
  assert.match(src, /disabled=\{savingGroup\}/);
  assert.doesNotMatch(src, /disabled=\{savingGroup \|\| !draftGroupName\.trim\(\)\}/);
});

test('NotesScreen binds drag responder directly to each custom group handle', () => {
  const src = read('src/features/notes/screens/NotesScreen.tsx');
  assert.match(src, /createDragResponder/);
  assert.match(src, /createDragResponder\(group\.id, index\)\.panHandlers/);
  assert.doesNotMatch(src, /pendingDragRef/);
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
