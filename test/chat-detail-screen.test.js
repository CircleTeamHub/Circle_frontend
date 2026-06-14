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

test('chat detail voice cleanup reads a JS snapshot, never the native recorder on unmount', () => {
  // 卸载时 recorder 的 native shared object 可能已释放，调 getStatus() 会抛
  // NativeSharedObjectNotFoundException。cleanup 必须用 ref 快照，且 stop() 兜底。
  const filePath = path.join(
    process.cwd(),
    'src/features/chat/screens/ChatDetailScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  // 崩溃根因表达式必须消失：cleanup 不能在 native 对象上链式取 isRecording。
  assert.doesNotMatch(source, /voiceRecorder\.getStatus\(\)\.isRecording/);
  // 改用纯 JS 快照 ref。
  assert.match(source, /isRecordingRef\.current\s*=\s*voiceRecorderState\.isRecording/);
  assert.match(source, /if \(isRecordingRef\.current\)/);
});

test('chat detail only restores recording audio mode after enabling it', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/chat/screens/ChatDetailScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /recordingAudioModeEnabledRef/);
  assert.match(
    source,
    /await setAudioModeAsync\(\{ allowsRecording: true, playsInSilentMode: true \}\);\s*\n\s*recordingAudioModeEnabledRef\.current = true;/,
  );
  assert.match(source, /if \(recordingAudioModeEnabledRef\.current\) \{/);
  assert.match(source, /recordingAudioModeEnabledRef\.current = false;/);
  assert.doesNotMatch(
    source,
    /void setAudioModeAsync\(\{ allowsRecording: false \}\)\.catch\(\(\) => undefined\);/,
  );
});

test('chat detail opens sent note cards from group chats', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/chat/screens/ChatDetailScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /case 'note-card':/);
  assert.match(source, /<NoteCardBubble[\s\S]*onPress=\{\(note\) =>/);
  assert.match(source, /getNoteDetailHref\(scope, note\.noteId, note\.ownerId \?\? ''\)/);
  assert.doesNotMatch(source, /pathname: '\/\(tabs\)\/profile\/notes\/\[id\]'/);
});

test('chat detail forwards long-pressed messages through a conversation picker', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/features/chat/screens/ChatDetailScreen.tsx'),
    'utf8',
  );

  assert.match(source, /useMessageForwardStore/);
  assert.match(source, /setPendingForward/);
  assert.match(source, /pathname:\s*'\/\(tabs\)\/messages\/forward-picker'/);
  assert.match(source, /handleMessageLongPress/);
  // Forward action is now localized via i18n instead of a hardcoded label.
  assert.match(source, /t\('chat\.messageActions\.forward'\)/);
});

test('chat detail protects group call creation from fast repeated taps', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/features/chat/screens/ChatDetailScreen.tsx'),
    'utf8',
  );

  assert.match(source, /callStartingRef/);
  assert.match(source, /if \(callStartingRef\.current\) return/);
  assert.match(source, /callStartingRef\.current = true/);
  assert.match(source, /callStartingRef\.current = false/);
  assert.match(source, /disabled=\{item\.id === 'voice-call' && callStarting\}/);
});

test('group call screen offers retry after a LiveKit connection error', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/features/call/screens/GroupCallScreen.tsx'),
    'utf8',
  );

  assert.match(source, /requestJoinToken/);
  assert.match(source, /handleRetryConnection/);
  assert.match(source, /setLiveKitCredentials/);
  assert.match(source, /重新连接/);
});

test('message forward picker route sends pending text and voice messages via OpenIM', () => {
  const route = fs.readFileSync(
    path.join(process.cwd(), 'app/(tabs)/messages/forward-picker.tsx'),
    'utf8',
  );
  const screen = fs.readFileSync(
    path.join(process.cwd(), 'src/features/chat/screens/ForwardPickerScreen.tsx'),
    'utf8',
  );
  const store = fs.readFileSync(
    path.join(process.cwd(), 'src/features/chat/store/use-message-forward-store.ts'),
    'utf8',
  );

  assert.match(route, /ForwardPickerScreen/);
  assert.match(store, /pending/);
  assert.match(screen, /sendTextMessage/);
  // Voice forwarding now delegates to one shared helper instead of branching
  // over sendVoiceMessageByUrl / sendVoiceMessage inline.
  assert.match(screen, /sendVoiceMessageFromSource/);
  assert.match(screen, /sendNoteCardMessage/);
  assert.match(screen, /sendFriendCardMessage/);
});

test('note detail routes exist in every tab stack so back returns to the source tab', () => {
  for (const relativePath of [
    'app/(tabs)/messages/notes/[id].tsx',
    'app/(tabs)/contacts/notes/[id].tsx',
    'app/(tabs)/discover/notes/[id].tsx',
    'app/(tabs)/profile/notes/[id].tsx',
  ]) {
    const filePath = path.join(process.cwd(), relativePath);
    assert.equal(fs.existsSync(filePath), true, `${relativePath} missing`);
    assert.match(fs.readFileSync(filePath, 'utf8'), /NoteDetailScreen/);
  }
});
