const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readChatDetailSource } = require('./helpers/chat-detail-source');

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
  assert.doesNotMatch(src, /toggleId\(prev, note\.id, MAX_NOTE_BATCH_SELECTION\)/);
  assert.doesNotMatch(src, /toggleSelectAll\(prev, visibleIds, MAX_NOTE_BATCH_SELECTION\)/);

  // 选择态 UI：全选/取消全选开关、已选计数、卡片选中标记。
  assert.match(src, /notes\.selection\.selectAll/);
  assert.match(src, /notes\.selection\.clearAll/);
  assert.match(src, /notes\.selection\.selectedCount/);
  assert.match(src, /selected=\{selectedSet\.has\(item\.id\)\}/);
});

test('NotesScreen selection bar sends directly and keeps the rest behind 其他选项', () => {
  const src = read('src/features/notes/screens/NotesScreen.tsx');

  // 多选底栏：常驻「发什么」选项行 + 「发送」直达选择聊天页；
  // 其余动作收进「其他选项」，即与单选同款的 NoteActionsSheet 批量态。
  assert.doesNotMatch(src, /notes\.selection\.next/);
  assert.match(src, /<NoteSendOptionsRow value=\{sendOptions\} onChange=\{setSendOptions\} \/>/);
  assert.match(src, /notes\.selection\.send/);
  assert.match(src, /onPress=\{handleSendSelected\}/);
  assert.match(src, /disabled=\{selectedIds\.length === 0 \|\| !hasAnyNoteSendOption\(sendOptions\)\}/);
  assert.match(src, /shareNotes\(selectedNotes, sendOptions\)/);
  assert.match(src, /notes\.selection\.moreOptions/);
  assert.match(src, /onPress=\{openBatchSheet\}/);
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

  // 普通多选禁用来源跳转；发送笔记的选择页显式允许查看资料，点击不冒泡到整卡。
  assert.match(card, /onSourcePress/);
  assert.match(card, /senderChip/);
  assert.match(card, /groupChip/);
  assert.match(card, /<Avatar/);
  assert.match(card, /chipsEnabled = Boolean\(onSourcePress\) && \(!selectionMode \|\| selectionSourceDetails\)/);
  assert.match(card, /stopPropagation/);
});

test('source chips open the right chat: sender -> private, group -> group conversation', () => {
  const screen = read('src/features/notes/screens/NotesScreen.tsx');

  assert.match(screen, /handleSourcePress/);
  assert.match(screen, /getChatDetailHref\(/);
  // 跳转目标由 resolveNoteCardButtons 统一给出（名片 → 聊天，与收藏来源一致时带原会话/原消息），
  // 行为测试见 test/note-card-peers.test.js。
  assert.match(screen, /resolveNoteCardButtons\(note\)/);
  assert.match(screen, /card\.conversationID,\s*card\.clientMsgID,/);
  assert.match(screen, /target === 'group' \? 'group' : 'private'/);
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

  // 部分失败必须把失败 id 交还父层并继续保持多选；只有全成功才退出。
  assert.match(sheet, /onSaved: \(result: \{[\s\S]{0,160}failedIds: string\[\]/);
  assert.match(sheet, /onSaved\(\{[\s\S]{0,160}failedIds: failed/);
  assert.match(screen, /\(\{ succeededIds, failedIds, remark \}(?::[\s\S]{0,120})?\) =>/);
  assert.match(
    screen,
    /if \(failedIds\.length > 0\) \{[\s\S]{0,180}setSelectedIds\(failedIds\)[\s\S]{0,180}setSelectionMode\(true\)[\s\S]{0,120}\} else \{[\s\S]{0,120}exitSelection\(\)/,
  );
});

test('ShareNoteSheet sends the selected notes to each chosen conversation through the shared pipeline', () => {
  const sheet = read('src/features/notes/components/ShareNoteSheet.tsx');
  const screen = read('src/features/notes/screens/NotesScreen.tsx');

  // 单条与批量共用：request = 笔记 + 发什么；每个选中的聊天都按同一条笔记管线发出，
  // 留言排在最后；部分失败给计数提示（不再有面板内的「重试失败项」）。
  assert.match(sheet, /request: NoteShareRequest \| null/);
  assert.match(sheet, /export interface NoteShareRequest \{\s*notes: NoteSummary\[\];\s*options: NoteSendOptions;/);
  // 先把所有对象都落到会话 id 再发:建单聊失败时一条都不发,重试不会重复投递。
  // 「查看」只等这一步(会话落定),不等内容发完。
  assert.match(sheet, /const lookup = resolveChatTargets\(chosen\);/);
  assert.match(sheet, /const resolution = lookup\.then\(\(\{ resolved \}\) => resolved, \(\) => \[\]\);/);
  assert.match(sheet, /const \{ resolved, failed \} = await lookup;/);
  assert.match(sheet, /for \(const \{ target, conversationId \} of resolved\)/);
  assert.match(
    sheet,
    /sendNotesToConversation\(\{\s*conversationId,\s*notes: shared\.notes,\s*options: shared\.options,/,
  );
  // 点发送立刻提示「已发送」(确定 / 查看),内容在后台接着发;关掉面板不停发,换账号才停。
  assert.match(sheet, /announceSent\(\{ t, targets: chosen, resolution, onDismiss: onClose \}\)/);
  assert.match(sheet, /const isActive = \(\) => useAuthStore\.getState\(\)\.user\?\.id === userId;/);
  assert.match(sheet, /failures \+= result\.failures/);
  assert.match(sheet, /sendTextMessage\(\{ conversationId, text: caption \}\)/);
  assert.doesNotMatch(sheet, /retryTasks|setRetryTasks/);
  // 选完对象只弹一次「发送给」确认框（可附留言），之后是统一的「已发送」；
  // 订单状态提醒已去掉。
  assert.match(sheet, /<SendConfirmDialog/);
  assert.doesNotMatch(sheet, /notes\.shareToChat\.(title|confirmTitle|confirmRecipientsMessage|confirmRetryMessage|sentTitle|sentRecipientsMessage|workStatusWarning)\b/);
  assert.match(sheet, /notes\.shareToChat\.partialFailed/);

  assert.match(screen, /handleBatchShare/);
  assert.match(screen, /<ShareNoteSheet request=\{shareNoteRequest\} onClose=\{closeShareNote\} \/>/);
  // 卡片载荷由管线现拼，屏幕层不再预先拼 NoteCardData。
  assert.doesNotMatch(screen, /buildNoteCardPayloadFromSummary/);

  // 只有分享入口使用聊天批量笔记的 9 条上限；其他批量动作仍可全选。
  assert.match(screen, /MAX_NOTE_BATCH_SELECTION/);
  assert.match(
    screen,
    /if \(notes\.length > MAX_NOTE_BATCH_SELECTION\) \{[\s\S]{0,240}Alert\.alert/,
  );
  assert.doesNotMatch(sheet, /notes\.slice\(0, MAX_NOTE_BATCH_SELECTION\)/);
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
  assert.match(picker, /notes\.groupPicker\.title/);
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
    ['notes', 'selection', 'send'],
    ['notes', 'selection', 'moreOptions'],
    ['notes', 'remarkSheet', 'title'],
    ['notes', 'remarkSheet', 'batchTitle'],
    ['notes', 'shareToChat', 'partialFailed'],
    ['notes', 'shareToChat', 'limitExceeded'],
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

test('lifecycle copy: 下架 60 天后自动删除，回收站已取消', () => {
  const zh = read('src/i18n/locales/zh.json');
  const unlistedScreen = read('src/features/notes/screens/UnlistedNotesScreen.tsx');

  // 语义拍板（2026-11-13）：两种下架合并，下架 60 天后服务端永久删除；删除即永久删除。
  assert.doesNotMatch(zh, /已下架笔记不会自动删除|回收站/);
  assert.match(zh, /下架 60 天后自动删除/);
  assert.match(unlistedScreen, /unlistedDaysLeft\(item\.unlistedAt, Date\.now\(\)\)/);
  assert.match(unlistedScreen, /relistNote/);
});

test('collecting a note offers 查看 that locates it in the notes list', () => {
  const chat = readChatDetailSource();
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
