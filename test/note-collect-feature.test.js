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

test('NoteDetailScreen 的来源入口只剩悬浮列，正文不再有来源卡片', () => {
  const src = read('src/features/notes/screens/NoteDetailScreen.tsx');

  assert.match(src, /collectedFrom/);
  assert.match(src, /conversationType === 'group'/);
  // 会话入**当前所在** tab 栈（笔记多挂 profile 下），返回时回到这张笔记而不是
  // IM 首页；写死 'messages' 会把聊天页推进消息栈，返回就串栈了。
  assert.match(src, /getChatDetailHref\(\s*scope/);
  assert.doesNotMatch(src, /getChatDetailHref\(\s*'messages'/);
  assert.match(src, /getUserProfileScopeFromSegments\(segments\)/);
  assert.match(src, /from\.clientMsgID/);
  // 来源卡片整块删除（连同 CTA 胶囊与它的文案/样式），来源只在悬浮列露出。
  assert.doesNotMatch(src, /sourceLocate/);
  assert.doesNotMatch(src, /sourceCard/);
  assert.doesNotMatch(src, /sourceGroupLabel|sourcePrivateLabel|sourceSharedBy/);
  // 快照缺关键字段、或 sender/group 都取不到时整组不渲染，避免点了跳不动。
  assert.match(src, /if \(!from\?\.conversationID \|\| !from\.clientMsgID\) return null/);
  assert.match(src, /if \(!sender && !group\) return null/);
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
  // 来源从纯文本升级成可点名片:私聊跳人、群聊跳群,各带无障碍标签。
  assert.match(src, /notes\.list\.openSenderChat/);
  assert.match(src, /notes\.list\.openGroupChat/);
});

test('note source i18n keys exist across all five locales', () => {
  for (const lng of ['zh', 'en', 'ja', 'ko', 'es']) {
    const json = JSON.parse(read(`src/i18n/locales/${lng}.json`));
    // 来源卡片删除后，卡片专用的四个 key 全部无引用 —— 留着就是死翻译。
    for (const dead of [
      'sourceLocate',
      'sourceGroupLabel',
      'sourcePrivateLabel',
      'sourceSharedBy',
    ]) {
      assert.equal(json.notes.detail[dead], undefined, `${lng} 残留 ${dead}`);
    }
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

test('来源按钮进聊天走当前 tab 栈，群按钮不再带气泡图标', () => {
  const list = read('src/features/notes/screens/NotesScreen.tsx');
  const detail = read('src/features/notes/screens/NoteDetailScreen.tsx');
  const card = read('src/features/notes/components/NoteCard.tsx');

  // 列表页与详情页都必须按当前所在栈推 scope。写死 'messages' 会把聊天页推进
  // 消息栈，返回时落到 IM 首页而不是来时的笔记页（两处都犯过这个错）。
  for (const [name, src] of [['NotesScreen', list], ['NoteDetailScreen', detail]]) {
    assert.match(src, /getUserProfileScopeFromSegments\(segments\)/, `${name} 缺 scope 推断`);
    assert.match(src, /getChatDetailHref\(\s*scope/, `${name} 未按 scope 入栈`);
    assert.doesNotMatch(src, /getChatDetailHref\(\s*'messages'/, `${name} 仍写死 messages 栈`);
  }

  // 群来源按钮已有群头像 + 群名，气泡图标是冗余装饰。
  assert.doesNotMatch(card, /chatbubbles-outline/);
});

test('笔记详情右下角悬浮列：私聊分享者 / 回群定位 / 下载', () => {
  const src = read('src/features/notes/screens/NoteDetailScreen.tsx');

  assert.match(src, /floatingDock/);
  // 三个动作各自独立，不再共用一个「查看原消息」跳转。
  assert.match(src, /const handleChatWithSender = useCallback/);
  assert.match(src, /const handleOpenGroupSource = useCallback/);
  // 下载入口整颗从顶栏移到悬浮列：仍是打开下载菜单，四种导出原样复用，
  // 顶栏不再留第二个下载按钮。
  assert.match(src, /onPress=\{\(\) => setDownloadMenuVisible\(true\)\}/);
  assert.match(src, /notes\.actions\.download/);
  assert.doesNotMatch(
    src,
    /headerIconBtn[\s\S]{0,200}?setDownloadMenuVisible\(true\)/,
  );

  // 私聊按钮永远跳私聊；群来源时原消息在群里，私聊不带定位参数。
  assert.match(src, /isGroup \? undefined : from\.conversationID/);
  assert.match(src, /isGroup \? undefined : from\.clientMsgID/);
  // 群按钮带 clientMsgID 定位到分享该笔记的原消息。
  assert.match(src, /'group',\s*\)/);

  // sender / group 分开暴露，各按钮自行判空（历史快照可能缺 sender）。
  assert.match(src, /const sender = from\.sender\?\.id/);
  assert.match(src, /collectedSource\?\.sender \? \(/);
  assert.match(src, /collectedSource\?\.group \? \(/);

  // 导出进行中禁用，避免重复触发后端导出。
  assert.match(src, /disabled=\{exporting !== null\}/);
});

test('悬浮列无障碍文案五语言齐备', () => {
  for (const lng of ['zh', 'en', 'ja', 'ko', 'es']) {
    const json = JSON.parse(read(`src/i18n/locales/${lng}.json`));
    assert.equal(typeof json.notes.detail.chatWithSender, 'string', `${lng} chatWithSender`);
    assert.equal(typeof json.notes.detail.openGroupSource, 'string', `${lng} openGroupSource`);
    assert.equal(typeof json.notes.detail.downloadPdf, 'string', `${lng} downloadPdf`);
  }
});
