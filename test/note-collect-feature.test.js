const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

// ── 收藏笔记 → 我的笔记（collectNote 流程）──────────────────────────────────

test('notes api exposes collectNote against the backend collect endpoint', () => {
  const api = read('src/services/api/notes.ts');

  assert.match(api, /export async function collectNote\(/);
  assert.match(api, /'\/note\/collect'/);
  assert.match(api, /method: 'POST'/);
  assert.match(api, /alreadyCollected: boolean/);
});

test('note types carry the collectedFrom source snapshot', () => {
  const types = read('src/features/notes/types.ts');

  assert.match(types, /export interface NoteCollectedFrom/);
  assert.match(types, /export interface CollectNoteSource/);
  assert.match(types, /clientMsgID: string/);
  assert.match(types, /collectedFrom\?: NoteCollectedFrom \| null/);
});

test('chat collect action routes note cards to collectNote instead of collections', () => {
  const src = read('src/features/chat/screens/ChatDetailScreen.tsx');

  assert.match(src, /message\.type === 'note-card'/);
  assert.match(src, /buildNoteCollectSource\(message, \{/);
  assert.match(src, /collectNote\(message\.noteCard\.noteId, source\)/);
  assert.match(src, /noteAlreadyCollected/);
  assert.match(src, /noteCollected/);
});

// ── 详情页来源名片：群名片 / 用户名片 + 跳回聊天定位 ─────────────────────────

test('NoteDetailScreen renders a source card and jumps back to the sharing message', () => {
  const src = read('src/features/notes/screens/NoteDetailScreen.tsx');

  // 群聊 → 群名片（附分享人）；私聊 → 对方名片。
  assert.match(src, /collectedFrom/);
  assert.match(src, /conversationType === 'group'/);
  assert.match(src, /isGroup \? from\.group : from\.sender/);
  assert.match(src, /sourceGroupLabel/);
  assert.match(src, /sourcePrivateLabel/);
  assert.match(src, /sourceSharedBy/);
  // 点击名片 → messages 栈打开会话，searchedMsgID 触发历史定位滚动。
  assert.match(src, /getChatDetailHref\(\s*'messages'/);
  assert.match(src, /from\.clientMsgID/);
  // 快照缺关键字段时整卡不渲染，避免点了跳不动。
  assert.match(src, /if \(!from\?\.conversationID \|\| !from\.clientMsgID\) return null/);
});

test('the source card is private to the note owner and never rides along on shares', () => {
  const detail = read('src/features/notes/screens/NoteDetailScreen.tsx');
  const payload = read('src/features/chat/utils/note-card-payload.ts');

  // 名片只给「我」看：详情页按归属兜底（后端也只对主人返回 collectedFrom）。
  assert.match(detail, /if \(!canEditNote\) return null/);
  // 转发/分享笔记的聊天卡片 payload 永远不携带来源快照。
  assert.doesNotMatch(payload, /collectedFrom/);
});

test('NoteCard shows the collect source on list rows', () => {
  const src = read('src/features/notes/components/NoteCard.tsx');

  assert.match(src, /note\.collectedFrom/);
  assert.match(src, /notes\.list\.fromSource/);
});

test('note source i18n keys exist across all five locales', () => {
  for (const lng of ['zh', 'en', 'ja', 'ko', 'es']) {
    const json = JSON.parse(read(`src/i18n/locales/${lng}.json`));
    assert.equal(typeof json.notes.detail.sourceGroupLabel, 'string', `${lng} sourceGroupLabel`);
    assert.equal(typeof json.notes.detail.sourcePrivateLabel, 'string', `${lng} sourcePrivateLabel`);
    assert.equal(typeof json.notes.detail.sourceSharedBy, 'string', `${lng} sourceSharedBy`);
    assert.equal(typeof json.notes.detail.sourceLocate, 'string', `${lng} sourceLocate`);
    assert.equal(typeof json.notes.list.fromSource, 'string', `${lng} fromSource`);
    assert.equal(
      typeof json.chat.messageActions.noteCollected,
      'string',
      `${lng} noteCollected`,
    );
  }
});

// ── 编辑页两处静默数据回归的修复 ───────────────────────────────────────────

test('EditNoteScreen preserves pinned and status when saving edits', () => {
  const src = read('src/features/notes/screens/EditNoteScreen.tsx');

  // 后端 PATCH 对缺省 pinned 按 false 处理：编辑必须原样回传置顶状态。
  assert.match(src, /pinnedRef\.current = note\.pinned/);
  assert.match(src, /updateNote\(id, \{ \.\.\.input, pinned: pinnedRef\.current \}\)/);
  // 编辑不携带 status（后端保留现状），否则「已下架」笔记编辑一次就被重新上架；
  // 仅新建时显式 ACTIVE。
  assert.match(src, /createNote\(\{ \.\.\.input, status: 'ACTIVE' \}\)/);
  assert.doesNotMatch(src, /updateNote\([^)]*status:/);
});

test('EditNoteScreen keeps keyboard from covering the bottom inputs', () => {
  const src = read('src/features/notes/screens/EditNoteScreen.tsx');

  assert.match(src, /KeyboardAvoidingView/);
  assert.match(src, /behavior=\{Platform\.OS === 'ios' \? 'padding' : undefined\}/);
});

// ── DOM 编辑器：序列化失败不能把正文覆盖成空文档 ──────────────────────────────

test('NoteBlockEditor.dom skips the update instead of emitting [] on serialize failure', () => {
  const src = read('src/features/notes/dom/NoteBlockEditor.dom.tsx');

  assert.doesNotMatch(src, /return '\[\]'/);
  assert.match(src, /function serializeBlocks\(\): string \| null/);
  assert.match(src, /if \(serialized != null\) onContentChange\(serialized\)/);
});

// ── 列表性能：memo 卡片 + 稳定回调 + 复用分隔线 ──────────────────────────────

test('NoteCard is memoized and NotesScreen feeds it stable callbacks', () => {
  const card = read('src/features/notes/components/NoteCard.tsx');
  const screen = read('src/features/notes/screens/NotesScreen.tsx');

  assert.match(card, /export const NoteCard = memo\(NoteCardInner\)/);
  assert.match(card, /onPress: \(note: NoteSummary\) => void/);
  assert.match(screen, /const openNote = useCallback/);
  assert.match(screen, /ItemSeparatorComponent=\{ItemSeparator\}/);
  // 内联箭头组件每次渲染都是新类型，FlatList 无法复用 —— 不允许回退。
  assert.doesNotMatch(screen, /ItemSeparatorComponent=\{\(\) =>/);
});
