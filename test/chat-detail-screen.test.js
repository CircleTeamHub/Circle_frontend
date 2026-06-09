const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('chat detail screen uses the aligned header and composer structure', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/chat/screens/ChatDetailScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /headerMeta/);
  assert.match(source, /headerStatusText/);
  assert.match(source, /messageListContent/);
  assert.match(source, /composerShell/);
  assert.match(source, /composerInput/);
});

test('chat detail screen exposes refined message insets and composer action hierarchy', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/chat/screens/ChatDetailScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /messageListInset/);
  assert.match(source, /composerActionBtn/);
  assert.match(source, /contentContainerStyle=\{\[s\.messageList, s\.messageListContent, s\.messageListInset\]\}/);
});

test('chat detail screen supports preview mode without an IM conversation', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/chat/screens/ChatDetailScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /const isPreviewMode = !conversationID/);
  assert.match(source, /当前仅预览聊天界面/);
  assert.match(source, /editable=\{!isPreviewMode\}/);
  assert.match(source, /disabled=\{sending \|\| isPreviewMode\}/);
});

test('chat detail screen wires a tappable emoji picker into the composer', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/chat/screens/ChatDetailScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /EmojiPicker/);
  assert.match(source, /emojiOpen/);
  assert.match(source, /handleEmojiToggle/);
  // 选中的 emoji 按光标位置插入草稿（而不是一律拼到末尾）
  assert.match(source, /onSelect=\{handleInsertEmoji\}/);
  assert.match(source, /selectionRef/);
  assert.match(source, /onSelectionChange=\{handleSelectionChange\}/);
});

test('chat detail screen reads the local chat background preference for the active conversation', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/chat/screens/ChatDetailScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /useChatPreferencesStore/);
  assert.match(source, /resolveChatBackgroundStyle/);
  assert.match(source, /ImageBackground/);
  assert.match(source, /backgroundPreference/);
  assert.match(source, /backgroundStyle/);
});

test('chat detail screen scopes custom background images to the message area', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/chat/screens/ChatDetailScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /messageArea/);
  assert.match(source, /messageAreaBackground/);
  assert.match(source, /messageAreaOverlay/);
  assert.match(
    source,
    /<View style=\{\[s\.messageArea, d\.messageArea\]\}>[\s\S]*<FlatList/,
  );
  assert.doesNotMatch(
    source,
    /<View style=\{\[d\.container,[\s\S]*?\]\}>[\s\S]*<ImageBackground[\s\S]*?style=\{StyleSheet\.absoluteFillObject\}/,
  );
  assert.match(source, /container:\s*\{\s*flex:\s*1,\s*backgroundColor:\s*colors\.background\s*\}/);
  assert.match(source, /inputBar:\s*\{\s*backgroundColor:\s*colors\.background\s*\}/);
});

test('chat detail screen logs text send failures without logging message bodies', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/chat/screens/ChatDetailScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /\[chat\] text send failed/);
  assert.match(source, /error instanceof Error/);
  // Both send paths route failures through one shared, dev-only helper.
  assert.match(source, /function logChatSendFailure/);
  const helperCalls = [...source.matchAll(/logChatSendFailure\(error, \{/g)];
  assert.equal(helperCalls.length, 2);
  // The single warn site never logs the message body.
  const warnBlocks = [
    ...source.matchAll(
      /console\.warn\(\s*'\[chat\] text send failed'[\s\S]*?\n\s*\);/g,
    ),
  ].map((match) => match[0]);
  assert.equal(warnBlocks.length, 1);
  for (const block of warnBlocks) {
    assert.doesNotMatch(block, /\btext:/);
    assert.doesNotMatch(block, /\bnextText\b/);
  }
});

test('chat detail attempts non-blocking history restore after initial message load', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/chat/screens/ChatDetailScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /restoreConversationMessages/);
  assert.match(
    source,
    /loadConversationMessages\(conversationID\)[\s\S]*restoreConversationMessages/,
  );
  assert.match(source, /conversationID/);
  assert.match(source, /sourceID/);
  assert.match(source, /sessionType:\s*conversationType/);
});
