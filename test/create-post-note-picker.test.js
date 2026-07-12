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

test('create post screen exposes a post expiry picker and submits expiresInHours', () => {
  const src = read('src/features/social/screens/CreatePostScreen.tsx');

  // 到期选项已 i18n 化（值常量 + 组件内本地化 label）。
  assert.match(src, /EXPIRY_VALUES|expiryOptions/);
  assert.match(src, /expiresInHours/);
  assert.match(src, /setExpiresInHours/);
  assert.match(src, /activePicker.*postExpiry/s);
  assert.match(src, /t\('plaza\.create\.expiryLabel'/);
  assert.match(src, /expiresInHours,\s*$/m);

  // 到期文案在两种语言里齐全。
  const en = JSON.parse(read('src/i18n/locales/en.json'));
  const zh = JSON.parse(read('src/i18n/locales/zh.json'));
  for (const k of ['expiryLabel', 'expiry24h', 'expiry3d', 'expiry7d']) {
    assert.ok(en.plaza.create[k], `en plaza.create.${k}`);
    assert.ok(zh.plaza.create[k], `zh plaza.create.${k}`);
  }
});

test('select note screen loads active notes and stores the chosen note for the post composer', () => {
  const src = read('src/features/social/screens/SelectNoteScreen.tsx');

  // 选择器展示全部非删除笔记（不限 ACTIVE，含「不公开」），后端 status 省略即默认非删除。
  assert.match(src, /fetchNotes\(\)/);
  assert.doesNotMatch(src, /fetchNotes\(\{ status: 'ACTIVE'/);
  assert.match(src, /setSelectedNote/);
  assert.match(src, /router\.back\(\)/);
  assert.match(src, /t\('plaza\.notePicker\.searchPlaceholder'\)/);
  assert.match(src, /t\('plaza\.notePicker\.none'\)/);
});

test('select note screen renders full note cards with stable search input', () => {
  const src = read('src/features/social/screens/SelectNoteScreen.tsx');

  assert.match(src, /NoteCard/);
  assert.match(src, /showActions=\{false\}/);
  assert.match(src, /renderItem=\{renderNote\}/);
  assert.match(src, /searchInput:\s*{[\s\S]*lineHeight:\s*20/);
  assert.match(src, /searchInput:\s*{[\s\S]*minHeight:\s*24/);
  assert.doesNotMatch(src, /noteRow:/);
  assert.doesNotMatch(src, /noteTitle:/);
});

test('share note picker renders full note cards with stable search input', () => {
  const src = read('src/features/chat/screens/SharePickerScreen.tsx');

  assert.match(src, /NoteCard/);
  assert.match(src, /showActions=\{false\}/);
  assert.match(src, /filteredNotes/);
  assert.match(src, /const renderNote = \(\{ item \}: \{ item: NoteSummary \}\) => \(\s*<NoteCard/);
  assert.match(src, /searchInput:\s*{[\s\S]*lineHeight:\s*20/);
  assert.match(src, /searchInput:\s*{[\s\S]*minHeight:\s*24/);
});

test('discover post flow exports a select-note route', () => {
  assert.equal(exists('app/(tabs)/discover/select-note.tsx'), true);
  const route = read('app/(tabs)/discover/select-note.tsx');
  assert.match(route, /SelectNoteScreen/);
});
