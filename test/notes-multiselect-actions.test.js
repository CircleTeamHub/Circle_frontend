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

test('NotesScreen selection bar is a single 下一步 that opens the batch actions sheet', () => {
  const src = read('src/features/notes/screens/NotesScreen.tsx');

  // 多选底栏收敛成一个「下一步」；动作全部收进与单选同款的 NoteActionsSheet 批量态。
  assert.match(src, /notes\.selection\.next/);
  assert.match(src, /setBatchSheetNotes\(selectedNotes\)/);
  assert.match(src, /batchNotes=\{batchSheetNotes\}/);
  assert.doesNotMatch(src, /notes\.selection\.group/);
  assert.doesNotMatch(src, /notes\.selection\.unlist/);
  assert.doesNotMatch(src, /notes\.selection\.delete/);

  // 批量动作与单选一一对应：置顶/备注/编辑分组/分享/下架/删除。
  assert.match(src, /onBatchPin=\{handleBatchPin\}/);
  assert.match(src, /onBatchRemark=\{handleBatchRemark\}/);
  assert.match(src, /onBatchEditGroups=\{handleBatchEditGroups\}/);
  assert.match(src, /onBatchShare=\{handleBatchShare\}/);
  assert.match(src, /onBatchUnlist=\{handleBatchUnlist\}/);
  assert.match(src, /onBatchDelete=\{handleBatchDelete\}/);

  // 批量执行：并发限流 settle，部分失败保留选中并提示，全部成功退出多选。
  assert.match(src, /runNoteBatch\(/);
  assert.match(src, /togglePinNote\(id, pinned\)/);
  assert.match(src, /notes\.alerts\.batchUnlistConfirm/);
  assert.match(src, /notes\.alerts\.batchDeleteConfirm/);
  assert.match(src, /notes\.alerts\.batchPartialFailed/);
  assert.match(src, /setSelectedIds\(failed\)/);

  // 单条删除也走确认 + 软删进回收站。
  assert.match(src, /handleDeleteNote/);
  assert.match(src, /deleteNote\(note\.id\)/);
  assert.match(src, /notes\.alerts\.deleteConfirm/);
});

test('NoteActionsSheet batch mode mirrors the single-note action set', () => {
  const sheet = read('src/features/notes/components/NoteActionsSheet.tsx');

  // 非空 batchNotes 即批量态；标题复用「已选 N 项」。
  assert.match(sheet, /batchNotes/);
  assert.match(sheet, /notes\.selection\.selectedCount/);
  // 置顶按「是否全部已置顶」决定置顶/取消置顶；多选项在批量态没有意义。
  assert.match(sheet, /every\(\(item\) => item\.pinned\)/);
  assert.match(sheet, /onBatchPin/);
  assert.doesNotMatch(sheet, /batch[\s\S]{0,400}onMultiSelect\(/);
  // 批量态不提供「编辑笔记」（编辑器天然单条，选 1 条也不显示——拍板 2026-08-16）。
  assert.doesNotMatch(sheet, /onEdit\(batch\[0\]\)/);
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
  // 群 chip 带收藏时的消息 id：进群直接定位到笔记原消息。
  assert.match(screen, /from\.clientMsgID,\s*'group',/);
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
  // 单条与批量共用同一个弹层：notes[] 为目标集合，批量保存走并发限流 settle。
  assert.match(sheet, /notes: NoteSummary\[\] \| null/);
  assert.match(sheet, /runNoteBatch\(/);
  assert.match(sheet, /setNoteRemark\(id, next\)/);
  assert.match(sheet, /notes\.remarkSheet\.batchTitle/);

  assert.match(screen, /<NoteRemarkSheet/);
  assert.match(screen, /handleRemarkSaved/);
  assert.match(types, /remark\?: string \| null/);
});

test('ShareNoteSheet sends every selected note card to the chosen conversation', () => {
  const sheet = read('src/features/notes/components/ShareNoteSheet.tsx');
  const screen = read('src/features/notes/screens/NotesScreen.tsx');

  // 单条与批量共用：payloads[] 逐条发卡，部分失败给计数提示。
  assert.match(sheet, /payloads: NoteCardData\[\] \| null/);
  assert.match(sheet, /for \(const payload of targets\)/);
  assert.match(sheet, /notes\.shareToChat\.confirmBatchMessage/);
  assert.match(sheet, /notes\.shareToChat\.partialFailed/);

  assert.match(screen, /handleBatchShare/);
  assert.match(screen, /buildNoteCardPayloadFromSummary/);
});

test('group picker adds/removes membership per note instead of replacing wholesale', () => {
  const picker = read('src/features/notes/components/NoteGroupPickerSheet.tsx');
  const screen = read('src/features/notes/screens/NotesScreen.tsx');

  // 三态底图（全部/部分/都不在）+ 只写回被显式改动的分组；未动的保持各自原样。
  assert.match(picker, /groupMembershipStates/);
  assert.match(picker, /applyGroupMembershipChanges/);
  assert.doesNotMatch(picker, /commonGroupIds/);
  assert.match(picker, /'mixed'/);
  assert.match(picker, /remove-circle/);
  // 零净变化不发请求，直接关闭。
  assert.match(picker, /ops\.length === 0/);
  assert.match(picker, /updateNoteGroupIds/);
  assert.match(picker, /runNoteBatch/);
  assert.match(picker, /notes\.groupPicker\.batchHint/);
  assert.match(picker, /notes\.alerts\.saveMembershipsPartialFailed/);
  // 弹层内可就地新建分组：上限拦截、成功并进父层 groups、新分组默认标记「加入」。
  assert.match(picker, /createNoteGroup/);
  assert.match(picker, /groups\.length >= MAX_NOTE_GROUPS/);
  assert.match(picker, /onGroupCreated\(created\)/);
  assert.match(picker, /\[created\.id\]: 'add'/);
  assert.match(screen, /onGroupCreated=\{handleGroupCreatedInPicker\}/);

  // 单条（sheet 的「编辑分组」）与批量（批量 sheet 的「编辑分组」）共用同一个弹层。
  assert.match(screen, /setGroupPickerNotes\(\[note\]\)/);
  assert.match(screen, /setGroupPickerNotes\(notes\)/);
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
    ['notes', 'selection', 'next'],
    ['notes', 'remarkSheet', 'title'],
    ['notes', 'remarkSheet', 'batchTitle'],
    ['notes', 'shareToChat', 'confirmBatchMessage'],
    ['notes', 'shareToChat', 'partialFailed'],
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

test('collecting a note offers 查看 that locates it in the notes list', () => {
  const chat = read('src/features/chat/screens/ChatDetailScreen.tsx');
  const screen = read('src/features/notes/screens/NotesScreen.tsx');
  const card = read('src/features/notes/components/NoteCard.tsx');

  // 添加成功的提示给两个按钮：查看(定位) + 确认。
  assert.match(chat, /common\.view/);
  assert.match(chat, /common\.confirm/);
  // 「查看」跳的是我的笔记**列表**并带定位参数，不是直接开详情页。
  assert.match(chat, /pathname: '\/\(tabs\)\/profile\/notes'/);
  assert.match(chat, /params: \{ highlightNoteId: copiedNoteId \}/);

  // 列表侧：复位到「全部」+ 清搜索（目标可能被 tab/搜索滤掉），滚动定位并高亮。
  assert.match(screen, /useLocalSearchParams<\{ highlightNoteId\?: string \}>/);
  assert.match(screen, /setActiveTab\('all'\)/);
  assert.match(screen, /scrollToIndex\(/);
  assert.match(screen, /onScrollToIndexFailed=\{handleScrollToIndexFailed\}/);
  // 同一个 id 只定位一次；且消费后把参数从路由摘掉，
  // 否则从详情页返回列表会被上一次的 id 再拽一遍。
  assert.match(screen, /handledHighlightRef/);
  assert.match(screen, /router\.setParams\(\{ highlightNoteId: undefined \}\)/);
  // 高亮是临时态，会自动消退。
  assert.match(screen, /setHighlightedNoteId\(null\)/);
  assert.match(card, /highlighted \? \{ backgroundColor: colors\.primaryLight \}/);
});
