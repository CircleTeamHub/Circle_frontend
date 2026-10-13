const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readChatDetailSource } = require('./helpers/chat-detail-source');

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

// ── 收藏笔记 → 我的笔记（collectNote 流程）──────────────────────────────────

test('notes api exposes collectNote against the backend collect endpoint', () => {
  const api = read('src/services/api/notes.ts');

  assert.match(api, /export async function collectNote\(/);
  assert.match(api, /'\/note\/collect'/);
  assert.match(api, /method: 'POST'/);
  assert.match(api, /alreadyCollected: boolean/);
  assert.match(api, /options\?\.title\?\.trim\(\)/);
});

test('collect title/group falls back cleanly for an older strict collect DTO', () => {
  const api = read('src/services/api/notes.ts');

  // Preprod can briefly run the old DTO with forbidNonWhitelisted enabled.
  // The client must retry only that explicit shape error, then persist the
  // selected title/group through the existing note update contract.
  assert.match(api, /isUnsupportedCollectOptionsError/);
  assert.match(api, /property\\s\+title\\s\+should\\s\+not\\s\+exist/);
  assert.match(api, /body: \{ noteId, source \}/);
  assert.match(api, /buildLegacyCollectUpdateInput/);
});

test('note types carry the collectedFrom source snapshot', () => {
  const types = read('src/features/notes/types.ts');

  assert.match(types, /export interface NoteCollectedFrom/);
  assert.match(types, /export interface CollectNoteSource/);
  assert.match(types, /clientMsgID: string/);
  assert.match(types, /collectedFrom\?: NoteCollectedFrom \| null/);
});

test('chat collect action routes note cards to collectNote instead of collections', () => {
  const src = readChatDetailSource();

  assert.match(src, /message\.type === 'note-card'/);
  assert.match(src, /message\.noteCard\.ownerId === currentUserID/);
  assert.match(src, /noteOwnCannotCollect/);
  assert.match(src, /noteAlreadyCollected/);
  assert.match(src, /buildNoteCollectSource\(message, \{/);
  assert.match(src, /setNoteCollectTarget\(/);
  assert.match(src, /collectNote\(target\.noteId, target\.source/);
  assert.match(src, /targetNoteGroupId/);
  assert.match(src, /title,\s*\n?\s*\}\);/);
  assert.match(src, /useNoteListSignalStore\.getState\(\)\.bump\(\)/);
  assert.match(src, /noteAlreadyCollected/);
  assert.match(src, /noteCollected/);
});

test('chat page disables its keyboard padding while the collect sheet is open', () => {
  const screen = readChatDetailSource();
  const hook = read('src/features/chat/chat-detail/hooks/use-collect-message.ts');

  // The sheet is a separate full-screen modal. Leaving the chat composer KAV
  // enabled while it is mounted lifts the sheet by the composer height on iOS.
  assert.match(hook, /noteCollectVisible: noteCollectTarget !== null \|\| noteCollectOpening/);
  assert.match(screen, /enabled=\{!noteCollectVisible\}/);
});

test('collect waits for the chat keyboard window to settle before presenting the sheet', () => {
  const hook = read('src/features/chat/chat-detail/hooks/use-collect-message.ts');

  assert.match(hook, /function waitForKeyboardToHide\(\)/);
  assert.match(hook, /await waitForKeyboardToHide\(\)/);
  assert.match(hook, /noteCollectOpening/);
  assert.match(hook, /noteCollectTarget !== null \|\| noteCollectOpening/);
  const sheet = read('src/features/notes/components/AddNoteToNotesSheet.tsx');
  assert.match(sheet, /<FloatingModal/);
  assert.doesNotMatch(sheet, /<BottomSheetModal/);
});

// ── 详情页来源名片：群名片 / 用户名片 + 跳回聊天定位 ─────────────────────────

test('NoteDetailScreen hides both card sections and source card actions', () => {
  const src = read('src/features/notes/screens/NoteDetailScreen.tsx');

  assert.match(src, /kind !== 'contact' && kind !== 'group'/);
  assert.doesNotMatch(src, /handleChatWithSender/);
  assert.doesNotMatch(src, /handleOpenGroupSource/);
  assert.doesNotMatch(src, /collectedSource\?\.sender/);
});

test('read-only details keep source card snapshots sanitized for forwarding payloads', () => {
  const detail = read('src/features/notes/screens/NoteDetailScreen.tsx');
  const payload = read('src/features/chat/utils/note-card-payload.ts');

  assert.match(detail, /kind !== 'contact' && kind !== 'group'/);
  assert.match(payload, /sourceGroupCardSnapshot/);
  assert.match(payload, /personalCardSnapshot/);
  assert.match(payload, /groupNames: \[\]/);
});

test('NoteCard shows the collect source on list rows', () => {
  const src = read('src/features/notes/components/NoteCard.tsx');

  // 底部按钮 = 笔记的个人名片/群名片（收藏来的由来源预填），统一由 resolveNoteCardButtons 产出；
  // 回退到收藏来源快照的逻辑见 test/note-card-peers.test.js。
  assert.match(src, /resolveNoteCardButtons\(note\)/);
  // 来源从纯文本升级成可点名片:私聊跳人、群聊跳群,各带无障碍标签。
  assert.match(src, /notes\.list\.openSenderChat/);
  assert.match(src, /notes\.list\.openGroupChat/);
});

test('NoteCard makes the source work status visible on every notes list', () => {
  const src = read('src/features/notes/components/NoteCard.tsx');

  assert.match(src, /statusBadge/);
  assert.match(src, /notes\.list\.statusWorking/);
  assert.match(src, /notes\.list\.statusClosed/);
  assert.match(src, /defaultValue: '打烊'/);
  assert.doesNotMatch(src, /statusClosed', \{ defaultValue: '打烊，状态可能变化' \}/);
  assert.match(src, /moon-outline/);
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
    assert.equal(
      typeof json.chat.messageActions.noteOwnCannotCollect,
      'string',
      `${lng} noteOwnCannotCollect`,
    );
  }
});

// ── 编辑页两处静默数据回归的修复 ───────────────────────────────────────────

test('EditNoteScreen keeps keyboard from covering the bottom inputs', () => {
  const src = read('src/features/notes/screens/EditNoteScreen.tsx');

  // Android edge-to-edge 下 adjustResize 不缩窗口：两端都走共享避让容器，
  // 不能再给 Android 传 behavior=undefined（那样键盘会直接盖住编辑区）。
  assert.match(src, /<KeyboardAvoidingContainer\b/);
  assert.doesNotMatch(src, /behavior=\{Platform\.OS === 'ios' \? 'padding' : undefined\}/);
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

test('笔记详情保留下载入口但不渲染来源名片按钮', () => {
  const detail = read('src/features/notes/screens/NoteDetailScreen.tsx');

  assert.match(detail, /floatingDock/);
  assert.match(detail, /onPress=\{\(\) => setDownloadMenuVisible\(true\)\}/);
  assert.match(detail, /notes\.actions\.download/);
  assert.doesNotMatch(detail, /collectedSource/);
});

test('悬浮列无障碍文案五语言齐备', () => {
  for (const lng of ['zh', 'en', 'ja', 'ko', 'es']) {
    const json = JSON.parse(read(`src/i18n/locales/${lng}.json`));
    assert.equal(typeof json.notes.detail.chatWithSender, 'string', `${lng} chatWithSender`);
    assert.equal(typeof json.notes.detail.openGroupSource, 'string', `${lng} openGroupSource`);
    assert.equal(typeof json.notes.detail.downloadPdf, 'string', `${lng} downloadPdf`);
  }
});

test('分享 sheet 支持就地搜索会话', () => {
  const src = read('src/features/notes/components/ShareNoteSheet.tsx');

  assert.match(src, /const \[query, setQuery\] = useState\(''\)/);
  assert.match(src, /item\.name\.toLowerCase\(\)\.includes\(trimmedQuery\)/);
  assert.match(src, /data=\{visibleConversations\}/);
  // 关闭时清搜索词，否则下次打开停在旧过滤结果上，看着像会话丢了。
  assert.match(src, /if \(!visible\) \{\s*setQuery\(''\)/);
  // 搜不到 ≠ 一个会话都没有，两种空态文案分开。
  assert.match(src, /notes\.shareToChat\.noMatch/);
  assert.match(src, /notes\.shareToChat\.empty/);
  // 点列表项不该被键盘吞掉第一次触摸。
  assert.match(src, /keyboardShouldPersistTaps="handled"/);

  for (const lng of ['zh', 'en', 'ja', 'ko', 'es']) {
    const json = JSON.parse(read(`src/i18n/locales/${lng}.json`));
    assert.equal(
      typeof json.notes.shareToChat.searchPlaceholder,
      'string',
      `${lng} searchPlaceholder`,
    );
    assert.equal(typeof json.notes.shareToChat.noMatch, 'string', `${lng} noMatch`);
  }
});

test('群来源收藏必须带上分享人头像', () => {
  const src = read('src/features/chat/utils/message-collection.ts');

  // 漏传第三个参数 faceURL 会让群来源的分享人永远存成无头像快照，
  // 而私聊来源有头像 —— 同一个人在笔记列表里两种样子（曾静默很久）。
  assert.match(
    src,
    /buildPeer\(\s*message\.senderID,\s*message\.senderName,\s*message\.senderAvatarUrl,?\s*\)/,
  );
  // 私聊侧一直是带头像的，别回退。
  assert.match(
    src,
    /buildPeer\(\s*context\.sourceID,\s*context\.conversationTitle,\s*context\.conversationAvatarUrl,?\s*\)/,
  );
});

test('笔记卡片的群来源用群头像组件', () => {
  const src = read('src/features/notes/components/NoteCard.tsx');

  // 群没头像时该回落成群组渐变图，不是通用 Avatar 的灰色人形（「人」的语义）。
  assert.match(src, /<GroupChatAvatar[\s\S]{0,120}?uri=\{groupChip\.faceURL \?\? null\}/);
});
