const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readChatDetailSource } = require('./helpers/chat-detail-source');

const read = (rel) =>
  fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

// 批量发笔记(多选 + 底栏常驻五选项行)的跨文件接线守护。
// 纯逻辑(任务展开/去重/节奏)由 src/features/chat/utils/note-batch-send.test.mts
// 直接单测;这里只看屏幕层有没有把这些纯函数接对。

test('share picker store carries note batches, not single notes', () => {
  const src = read('src/features/chat/store/use-share-picker-store.ts');

  assert.match(src, /kind: 'note-batch'; notes: NoteSummary\[\]; options: NoteSendOptions/);
  assert.doesNotMatch(src, /kind: 'note'; data: NoteSummary/);
});

test('chat detail consumes note batches through the pure task planner', () => {
  const src = readChatDetailSource();
  // 任务展开/拷贝/节奏/发送已抽进共享管线(笔记分享面板也走它),屏幕只负责接线。
  const pipeline = read('src/features/chat/utils/send-notes-to-conversation.ts');

  assert.match(src, /case 'note-batch':/);
  assert.match(src, /handlePickNoteBatch\(item\.notes, item\.options\)/);
  // 批与批串行(共享服务端 20/10s 限流桶),离开会话即停发剩余任务。
  assert.match(src, /noteBatchQueueRef/);
  assert.match(src, /if \(!mountedRef\.current\) return;/);
  assert.match(src, /sendNotesToConversation\(\{[\s\S]{0,300}isActive: \(\) => mountedRef\.current/);
  // 媒体分区必须先经服务端拷贝进自己的 chat/ 命名空间,不许直接拿笔记 key 发;
  // 没有媒体的笔记不许白耗拷贝配额。
  assert.match(pipeline, /sectionsToImport\(options\)/);
  assert.match(pipeline, /sections\.length > 0 && note\.mediaCount > 0/);
  assert.match(pipeline, /importNoteChatMedia\(note\.id, sections\)/);
  // 地址只在详情里:摘要拿不到可用坐标时按需拉一次详情;明确无地址的笔记跳过,
  // 拉取失败必须计入 failures(不许静默变成"什么都没发还零提示")。
  assert.match(pipeline, /resolveSendableNoteLocation\(location\)/);
  assert.match(pipeline, /note\.hasLocation !== false/);
  assert.match(pipeline, /fetchNoteDetail\(note\.id\)/);
  // 失败提示保留首个错误的语义映射 + 非预期失败上报。
  assert.match(src, /getChatSendErrorMessage\(firstError, countMessage\)/);
  assert.match(pipeline, /reportChatSendFailure\(kind, error\)/);
  assert.match(pipeline, /recordFailure\(task\.kind, error\)/);
  // 进了发送队列就排下一条,不逐条等送达(断线时一条要等一分钟);
  // 汇总提示要等全部有了结果。
  assert.match(pipeline, /await Promise\.all\(deliveries\)/);
  // 四种任务各走对应的发送通道。
  assert.match(pipeline, /buildNoteSendTasks\(note, options, imported, location\)/);
  assert.match(pipeline, /sendImageMessage\(\{\s*conversationId,\s*key: task\.key/);
  assert.match(pipeline, /sendVideoMessage\(\{\s*conversationId,\s*key: task\.key/);
  assert.match(pipeline, /sendLocationMessage\(\{\s*conversationId,\s*latitude: task\.latitude/);
  // 所有批次共享真实滚动 10 秒窗口；每次发送前等槽位并记录尝试。
  assert.match(src, /noteSendTimestampsRef/);
  assert.match(src, /sendTimestamps: noteSendTimestampsRef/);
  assert.match(pipeline, /noteSendWindowDelayMs\(sendTimestamps\.current, now\)/);
  assert.match(
    pipeline,
    /recordNoteSendAttempt\(\s*sendTimestamps\.current,\s*now,?\s*\)/,
  );
  assert.doesNotMatch(pipeline, /notePacingDelayMs\(tasks\.length\)/);
});

test('note chat-media import API posts the section list', () => {
  const src = read('src/services/api/notes.ts');
  const types = read('src/features/notes/types.ts');
  const pipeline = read('src/features/chat/utils/send-notes-to-conversation.ts');

  assert.match(src, /\/note\/\$\{noteId\}\/chat-media/);
  assert.match(src, /body: \{ sections \}/);
  assert.match(types, /interface NoteChatMediaImportResult \{[\s\S]{0,180}failedCount\?: number/);
  assert.match(pipeline, /const importedResult = await importNoteChatMedia\(note\.id, sections\)/);
  assert.match(pipeline, /failures \+= importedResult\.failedCount \?\? 0/);
  assert.match(pipeline, /imported = importedResult\.items/);
});

test('note remark editor saves through the remark API with the shared cap', () => {
  const sheet = read('src/features/notes/components/NoteRemarkSheet.tsx');
  const api = read('src/services/api/notes.ts');

  // 上限与后端 SetNoteRemarkDto 对齐;空白串保存即清除(落 null)。
  assert.match(sheet, /REMARK_MAX_LENGTH = 200/);
  assert.match(sheet, /maxLength=\{REMARK_MAX_LENGTH\}/);
  assert.match(sheet, /trimmed\.length > 0 \? trimmed : null/);
  // 单条与批量同路径：runNoteBatch 逐条 PATCH。
  assert.match(sheet, /setNoteRemark\(id, next\)/);
  assert.match(api, /\/note\/\$\{id\}\/remark/);

  // 备注是主人私有标注:卡片上仅在有值时渲染。
  const card = read('src/features/notes/components/NoteCard.tsx');
  assert.match(card, /note\.remark \?/);
  assert.match(card, /notes\.list\.remark/);
});
