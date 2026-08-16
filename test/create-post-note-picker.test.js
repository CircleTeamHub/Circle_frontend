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
  // 多选模式:整卡点按即切换选中;勾选指示复用 NoteCard 自带的 selectionMode,
  // 不许在选择器里再手搓一套 checkbox(视觉/无障碍来源必须唯一)。
  assert.match(src, /onPress=\{toggleNote\}/);
  assert.match(src, /selectionMode\s/);
  assert.match(src, /selected=\{selectedNotes\.some/);
  assert.doesNotMatch(src, /noteCheck/);
  assert.match(src, /searchInput:\s*{[\s\S]*lineHeight:\s*20/);
  assert.match(src, /searchInput:\s*{[\s\S]*minHeight:\s*24/);
});

test('share note picker sends through the inline always-visible options row', () => {
  const src = read('src/features/chat/screens/SharePickerScreen.tsx');

  // 选择上限来自纯 util(与批量消息量约束联动),不许在屏幕里写死数字。
  assert.match(src, /MAX_NOTE_BATCH_SELECTION/);
  assert.doesNotMatch(src, /prev\.length >= 9\b/);
  // 五个选项常驻底栏(发送键上方一行横排 icon+短标签),不再点发送后弹确认 sheet。
  for (const key of ['optionCard', 'optionMedia', 'optionShowcase', 'optionLocation', 'optionAll']) {
    assert.match(src, new RegExp(`share\\.noteBatch\\.${key}`));
  }
  assert.match(src, /NOTE_OPTION_CHIPS/);
  assert.doesNotMatch(src, /BottomSheetModal/);
  assert.doesNotMatch(src, /optionsOpen/);
  assert.match(src, /withAllNoteSendOptions/);
  assert.match(src, /isAllNoteSendOptions/);
  // 至少勾一项才能发送;发送键直接按当前勾选以 note-batch 形态交给聊天页消费。
  assert.match(src, /hasAnyNoteSendOption/);
  assert.match(src, /onPress=\{handleConfirmSend\}/);
  assert.match(src, /kind: 'note-batch'/);
  assert.match(src, /notes: selectedNotes/);
  assert.match(src, /options: sendOptions/);
});

test('discover post flow exports a select-note route', () => {
  assert.equal(exists('app/(tabs)/discover/select-note.tsx'), true);
  const route = read('app/(tabs)/discover/select-note.tsx');
  assert.match(route, /SelectNoteScreen/);
});
