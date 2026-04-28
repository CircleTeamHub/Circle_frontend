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

test('NotesScreen refreshes notes and groups when returning from note edits', () => {
  const src = read('src/features/notes/screens/NotesScreen.tsx');
  assert.match(src, /useFocusEffect/);
  assert.match(src, /void load\(\)/);
  assert.doesNotMatch(src, /useEffect\(\(\) => \{\s*let cancelled = false;[\s\S]*load\(\)\.catch/);
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

test('NotesScreen lets a group directly choose which notes belong to it', () => {
  const src = read('src/features/notes/screens/NotesScreen.tsx');
  assert.match(src, /editingMembershipGroup/);
  assert.match(src, /openGroupMembershipEditor/);
  assert.match(src, /toggleMembershipNote/);
  assert.match(src, /handleSaveGroupMemberships/);
  assert.match(src, /选择笔记/);
  assert.match(src, /保存选择/);
  assert.match(src, /fetchNoteDetail/);
  assert.match(src, /updateNote/);
  assert.match(src, /groupIds:\s*nextGroupIds/);
});

test('NotesScreen optimizes group note assignment for larger note lists', () => {
  const src = read('src/features/notes/screens/NotesScreen.tsx');
  assert.match(src, /membershipSearch/);
  assert.match(src, /filteredMembershipNotes/);
  assert.match(src, /renderMembershipNote/);
  assert.match(src, /membershipList/);
  assert.match(src, /搜索笔记/);
  assert.match(src, /runWithConcurrencyLimit/);
  assert.match(src, /MEMBERSHIP_SAVE_CONCURRENCY/);
  assert.match(src, /keyExtractor=\{\(item\) => item\.id\}/);
});

test('NotesScreen keeps group management action fixed beside the scrollable tabs', () => {
  const src = read('src/features/notes/screens/NotesScreen.tsx');
  assert.match(src, /<View style=\{s\.tabsRow\}>/);
  assert.match(src, /style=\{s\.tabsScroll\}/);
  assert.match(src, /<Pressable style=\{s\.manageTab\} onPress=\{\(\) => setManagerVisible\(true\)\}>/);
  assert.match(src, /tabsScroll:\s*{[^}]*flex:\s*1/);
  assert.match(src, /manageTab:\s*{[^}]*width:\s*40/);

  const scrollStart = src.indexOf('<ScrollView');
  const scrollEnd = src.indexOf('</ScrollView>', scrollStart);
  const manageButton = src.indexOf('<Pressable style={s.manageTab}', scrollStart);
  assert.ok(scrollStart >= 0 && scrollEnd > scrollStart);
  assert.ok(manageButton > scrollEnd);
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

test('NotesScreen uses stable drag responders directly on each custom group handle', () => {
  const src = read('src/features/notes/screens/NotesScreen.tsx');
  assert.match(src, /dragRespondersRef/);
  assert.match(src, /getDragResponder/);
  assert.match(src, /groupsRef\.current\.findIndex/);
  assert.match(src, /getDragResponder\(group\.id\)\.panHandlers/);
  assert.doesNotMatch(src, /pendingDragRef/);
  assert.doesNotMatch(src, /createDragResponder\(group\.id, index\)\.panHandlers/);
});

test('NotesScreen prevents ScrollView from stealing group drag gestures', () => {
  const src = read('src/features/notes/screens/NotesScreen.tsx');
  assert.match(src, /scrollEnabled=\{!draggingGroupId\}/);
  assert.match(src, /onMoveShouldSetPanResponderCapture:\s*\(\) => true/);
  assert.match(src, /onShouldBlockNativeResponder:\s*\(\) => true/);
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
