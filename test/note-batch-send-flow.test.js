const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) =>
  fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

// 批量发笔记(多选 + 五选项 sheet)的跨文件接线守护。
// 纯逻辑(任务展开/去重/节奏)由 src/features/chat/utils/note-batch-send.test.mts
// 直接单测;这里只看屏幕层有没有把这些纯函数接对。

test('share picker store carries note batches, not single notes', () => {
  const src = read('src/features/chat/store/use-share-picker-store.ts');

  assert.match(src, /kind: 'note-batch'; notes: NoteSummary\[\]; options: NoteSendOptions/);
  assert.doesNotMatch(src, /kind: 'note'; data: NoteSummary/);
});

test('chat detail consumes note batches through the pure task planner', () => {
  const src = read('src/features/chat/screens/ChatDetailScreen.tsx');

  assert.match(src, /case 'note-batch':/);
  assert.match(src, /handlePickNoteBatch\(item\.notes, item\.options\)/);
  // 批与批串行(共享服务端 20/10s 限流桶),离开会话即停发剩余任务。
  assert.match(src, /noteBatchQueueRef/);
  assert.match(src, /if \(!mountedRef\.current\) return;/);
  // 媒体分区必须先经服务端拷贝进自己的 chat/ 命名空间,不许直接拿笔记 key 发;
  // 没有媒体的笔记不许白耗拷贝配额。
  assert.match(src, /sectionsToImport\(options\)/);
  assert.match(src, /sections\.length > 0 && note\.mediaCount > 0/);
  assert.match(src, /importNoteChatMedia\(note\.id, sections\)/);
  // 地址只在详情里:摘要拿不到可用坐标时按需拉一次详情;明确无地址的笔记跳过,
  // 拉取失败必须计入 failures(不许静默变成"什么都没发还零提示")。
  assert.match(src, /resolveSendableNoteLocation\(location\)/);
  assert.match(src, /note\.hasLocation !== false/);
  assert.match(src, /fetchNoteDetail\(note\.id\)/);
  // 失败提示保留首个错误的语义映射 + 非预期失败上报。
  assert.match(src, /getChatSendErrorMessage\(firstError, countMessage\)/);
  assert.match(src, /reportChatSendFailure\(task\.kind, error\)/);
  // 四种任务各走对应的发送通道。
  assert.match(src, /buildNoteSendTasks\(note, options, imported, location\)/);
  assert.match(src, /sendImageMessage\(\{\s*conversationId: conversationID,\s*key: task\.key/);
  assert.match(src, /sendVideoMessage\(\{\s*conversationId: conversationID,\s*key: task\.key/);
  assert.match(src, /sendLocationMessage\(\{\s*conversationId: conversationID,\s*latitude: task\.latitude/);
  // 大批次匀速发送,压在服务端 send 限流之下。
  assert.match(src, /notePacingDelayMs\(tasks\.length\)/);
});

test('note chat-media import API posts the section list', () => {
  const src = read('src/services/api/notes.ts');

  assert.match(src, /\/note\/\$\{noteId\}\/chat-media/);
  assert.match(src, /body: \{ sections \}/);
});

test('note remark editor saves through the remark API with the shared cap', () => {
  const sheet = read('src/features/notes/components/NoteRemarkSheet.tsx');
  const api = read('src/services/api/notes.ts');

  // 上限与后端 SetNoteRemarkDto 对齐;空白串保存即清除(落 null)。
  assert.match(sheet, /REMARK_MAX_LENGTH = 200/);
  assert.match(sheet, /maxLength=\{REMARK_MAX_LENGTH\}/);
  assert.match(sheet, /trimmed\.length > 0 \? trimmed : null/);
  assert.match(sheet, /setNoteRemark\(note\.id, next\)/);
  assert.match(api, /\/note\/\$\{id\}\/remark/);

  // 备注是主人私有标注:卡片上仅在有值时渲染。
  const card = read('src/features/notes/components/NoteCard.tsx');
  assert.match(card, /note\.remark \?/);
  assert.match(card, /notes\.list\.remark/);
});
