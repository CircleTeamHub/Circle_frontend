const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const readJson = (rel) => JSON.parse(read(rel));

const LOCALES = ['zh', 'en', 'ja', 'ko', 'es'];

test('NotesScreen wires multi-select: long-press/menu entry, select-all, prune on reload', () => {
  const src = read('src/features/notes/screens/NotesScreen.tsx');

  // 进入路径：卡片长按 + 动作菜单「多选」两条都要有。
  assert.match(src, /onLongPress=\{handleCardLongPress\}/);
  assert.match(src, /onMultiSelect=\{handleMultiSelectFromMenu\}/);
  assert.match(src, /enterSelection/);
  assert.match(src, /exitSelection/);

  // 选择状态用纯函数维护（配套 note-selection.test.mts 直测），刷新后修剪失效项。
  assert.match(src, /toggleId\(/);
  assert.match(src, /toggleSelectAll\(/);
  assert.match(src, /pruneSelection\(/);

  // 选择态 UI：全选/取消全选开关、已选计数、卡片选中标记。
  assert.match(src, /notes\.selection\.selectAll/);
  assert.match(src, /notes\.selection\.clearAll/);
  assert.match(src, /notes\.selection\.selectedCount/);
  assert.match(src, /selected=\{selectedSet\.has\(item\.id\)\}/);
});

test('NotesScreen batch bar runs group/unlist/delete over the selection with confirm + settle', () => {
  const src = read('src/features/notes/screens/NotesScreen.tsx');

  assert.match(src, /handleBatchEditGroups/);
  assert.match(src, /handleBatchUnlist/);
  assert.match(src, /handleBatchDelete/);
  assert.match(src, /notes\.selection\.group/);
  assert.match(src, /notes\.selection\.unlist/);
  assert.match(src, /notes\.selection\.delete/);

  // 批量执行：并发限流 settle，部分失败保留选中并提示，全部成功退出多选。
  assert.match(src, /runNoteBatch\(/);
  assert.match(src, /notes\.alerts\.batchUnlistConfirm/);
  assert.match(src, /notes\.alerts\.batchDeleteConfirm/);
  assert.match(src, /notes\.alerts\.batchPartialFailed/);
  assert.match(src, /setSelectedIds\(failed\)/);

  // 单条删除也走确认 + 软删进回收站。
  assert.match(src, /handleDeleteNote/);
  assert.match(src, /deleteNote\(note\.id\)/);
  assert.match(src, /notes\.alerts\.deleteConfirm/);
});

test('NoteCard renders selection state, owner remark, and tappable source chips', () => {
  const card = read('src/features/notes/components/NoteCard.tsx');

  // 选择态：右侧 ⋯ 槽位换选择圈，整卡点击由父层分流。
  assert.match(card, /selectionMode/);
  assert.match(card, /checkmark-circle/);
  assert.match(card, /ellipse-outline/);
  assert.match(card, /accessibilityState=\{selectionMode \? \{ selected \} : undefined\}/);

  // 备注行：仅笔记主人可见的私人标注。
  assert.match(card, /note\.remark/);
  assert.match(card, /notes\.list\.remark/);

  // 来源双 chip：发送者 + 来源群，带头像；多选模式禁用跳转；点击不冒泡到整卡。
  assert.match(card, /onSourcePress/);
  assert.match(card, /senderChip/);
  assert.match(card, /groupChip/);
  assert.match(card, /<Avatar/);
  assert.match(card, /chipsEnabled = Boolean\(onSourcePress\) && !selectionMode/);
  assert.match(card, /stopPropagation/);
});

test('source chips open the right chat: sender -> private, group -> group conversation', () => {
  const screen = read('src/features/notes/screens/NotesScreen.tsx');

  assert.match(screen, /handleSourcePress/);
  assert.match(screen, /getChatDetailHref\(/);
  assert.match(screen, /'group',\s*\)/);
  assert.match(screen, /'private',\s*\)/);
  // 私聊只在快照本来就是私聊会话时带 conversationID，群聊直接用来源会话。
  assert.match(
    screen,
    /from\.conversationType === 'private' \? from\.conversationID : undefined/,
  );
});

test('remark is wired end to end: PATCH api, sheet editor, in-place list update', () => {
  const api = read('src/services/api/notes.ts');
  const sheet = read('src/features/notes/components/NoteRemarkSheet.tsx');
  const screen = read('src/features/notes/screens/NotesScreen.tsx');
  const types = read('src/features/notes/types.ts');

  assert.match(api, /setNoteRemark/);
  assert.match(api, /\/note\/\$\{id\}\/remark/);
  assert.match(api, /method: 'PATCH'/);

  // 输入上限与后端 SetNoteRemarkDto 的 NOTE_REMARK_MAX_LENGTH 对齐。
  assert.match(sheet, /REMARK_MAX_LENGTH = 200/);
  assert.match(sheet, /maxLength=\{REMARK_MAX_LENGTH\}/);
  // 留空保存即清除（trim 后空串归一为 null）。
  assert.match(sheet, /trimmed\.length > 0 \? trimmed : null/);

  assert.match(screen, /<NoteRemarkSheet/);
  assert.match(screen, /handleRemarkSaved/);
  assert.match(types, /remark\?: string \| null/);
});

test('group picker replaces memberships for single and batch targets', () => {
  const picker = read('src/features/notes/components/NoteGroupPickerSheet.tsx');
  const screen = read('src/features/notes/screens/NotesScreen.tsx');

  assert.match(picker, /updateNoteGroupIds/);
  assert.match(picker, /commonGroupIds/);
  assert.match(picker, /runNoteBatch/);
  assert.match(picker, /notes\.groupPicker\.batchHint/);
  assert.match(picker, /notes\.alerts\.saveMembershipsPartialFailed/);

  // 单条（sheet 的「编辑分组」）与批量（底栏「分组」）共用同一个弹层。
  assert.match(screen, /setGroupPickerNotes\(\[note\]\)/);
  assert.match(screen, /setGroupPickerNotes\(selectedNotes\)/);
  assert.match(screen, /<NoteGroupPickerSheet/);
});

test('all five locales carry the new multi-select/remark/group-picker keys', () => {
  const required = [
    ['notes', 'actions', 'multiSelect'],
    ['notes', 'actions', 'remark'],
    ['notes', 'actions', 'editNote'],
    ['notes', 'actions', 'editGroups'],
    ['notes', 'actions', 'delete'],
    ['notes', 'list', 'remark'],
    ['notes', 'list', 'openSenderChat'],
    ['notes', 'list', 'openGroupChat'],
    ['notes', 'selection', 'selectedCount'],
    ['notes', 'selection', 'selectAll'],
    ['notes', 'selection', 'clearAll'],
    ['notes', 'selection', 'group'],
    ['notes', 'selection', 'unlist'],
    ['notes', 'selection', 'delete'],
    ['notes', 'remarkSheet', 'title'],
    ['notes', 'remarkSheet', 'placeholder'],
    ['notes', 'remarkSheet', 'save'],
    ['notes', 'remarkSheet', 'saving'],
    ['notes', 'groupPicker', 'title'],
    ['notes', 'groupPicker', 'batchHint'],
    ['notes', 'groupPicker', 'empty'],
    ['notes', 'groupPicker', 'save'],
    ['notes', 'groupPicker', 'saving'],
    ['notes', 'alerts', 'deleteTitle'],
    ['notes', 'alerts', 'deleteConfirm'],
    ['notes', 'alerts', 'batchUnlistTitle'],
    ['notes', 'alerts', 'batchUnlistConfirm'],
    ['notes', 'alerts', 'batchDeleteTitle'],
    ['notes', 'alerts', 'batchDeleteConfirm'],
    ['notes', 'alerts', 'batchFailedTitle'],
    ['notes', 'alerts', 'batchPartialFailed'],
    ['notes', 'alerts', 'remarkFailedTitle'],
  ];

  for (const locale of LOCALES) {
    const data = readJson(`src/i18n/locales/${locale}.json`);
    for (const keyPath of required) {
      let node = data;
      for (const part of keyPath) {
        node = node?.[part];
      }
      assert.equal(
        typeof node,
        'string',
        `${locale}.json missing ${keyPath.join('.')}`,
      );
    }
  }
});

test('lifecycle copy: unlisted never auto-deletes, recycle bin purges after 30 days', () => {
  const zh = read('src/i18n/locales/zh.json');
  const unlistedScreen = read('src/features/notes/screens/UnlistedNotesScreen.tsx');
  const recycleScreen = read('src/features/notes/screens/RecycleBinScreen.tsx');

  // 下架不再宣称自动删除；回收站承接 30 天到期清理（后端 note-recycle-bin.cleanup 落地）。
  assert.match(zh, /已下架笔记不会自动删除/);
  assert.doesNotMatch(zh, /已下架笔记会在一个月后自动删除/);
  assert.match(zh, /已删除的笔记可在这里恢复，30 天后自动清除。/);
  assert.match(unlistedScreen, /不会自动删除/);
  assert.match(recycleScreen, /30 天后自动清除/);

  // 恢复/上架入口仍在两个屏幕上。
  assert.match(unlistedScreen, /relistNote/);
  assert.match(recycleScreen, /restoreNote/);
});
