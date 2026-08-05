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
  // 预览态文案已改为「连接尚未完成」（IM 未就绪的准确提示，替代旧的「仅预览」框架）
  assert.match(source, /连接尚未完成/);
  assert.match(source, /editable=\{!isPreviewMode\}/);
  assert.match(source, /disabled=\{sending \|\| isPreviewMode \|\| isVoiceRecording\}/);
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

test('re-sending a collected favorite rebuilds by original type via resolveCollectionSendPlan', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/chat/screens/ChatDetailScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  // 按 plan 分发：文本走草稿、语音/笔记/名片按原类型重建。
  assert.match(source, /resolveCollectionSendPlan\(item\)/);
  assert.match(source, /plan\.kind === 'text'/);
  assert.match(source, /case 'voice':/);
  assert.match(source, /case 'note':/);
  assert.match(source, /case 'friend':/);
  // 不再有 ⭐ / title 装饰，正文不重复。
  assert.doesNotMatch(source, /⭐/);
  assert.doesNotMatch(source, /\$\{item\.title\}\$\{item\.summary/);
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

test('chat detail treats the complete thumbnail upload path as best effort', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/chat/screens/ChatDetailScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /uploadChatImageThumbnail\(/);
});

test('chat detail quote action preserves the current draft text', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/chat/screens/ChatDetailScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');
  const handlerMatch = source.match(
    /const handleQuoteMessage = useCallback\(\(message: ChatMessage\) => \{[\s\S]*?\}, \[\]\);/,
  );

  assert.ok(handlerMatch, 'quote handler should exist');
  assert.match(handlerMatch[0], /setQuoteTarget\(message\)/);
  assert.doesNotMatch(handlerMatch[0], /setDraft\(''\)/);
});

test('chat detail virtualizes and caps group mention candidates', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/chat/screens/ChatDetailScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /const MENTION_CANDIDATE_LIMIT = 200/);
  assert.match(source, /loadGroupMemberList\(sourceID, MENTION_CANDIDATE_LIMIT\)/);
  assert.match(source, /<FlatList[\s\S]*data=\{visibleMentionCandidates\}/);
  assert.doesNotMatch(source, /visibleMentionCandidates\.map\(\(member\)/);
});

test('chat detail exposes @all as the first group mention candidate', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/features/chat/screens/ChatDetailScreen.tsx'),
    'utf8',
  );

  assert.match(source, /AT_ALL_USER_ID/);
  assert.match(source, /allMentionTarget/);
  assert.match(source, /setMentionCandidates\(\[allMentionTarget, \.\.\.cached\]\)/);
  assert.match(source, /setMentionCandidates\(\[allMentionTarget, \.\.\.candidates\]\)/);
});

test('chat detail caches group mention candidates and de-dupes in-flight loads', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/features/chat/screens/ChatDetailScreen.tsx'),
    'utf8',
  );
  const loaderBlock =
    source.match(/const loadMentionCandidates = useCallback\(async \(\) => \{[\s\S]*?\}, \[[^\]]*\]\);/)?.[0] ??
    '';

  assert.match(source, /mentionCandidatesCacheRef/);
  assert.match(source, /mentionCandidatesInflightRef/);
  assert.match(loaderBlock, /mentionCandidatesCacheRef\.current\.get\(sourceID\)/);
  assert.match(loaderBlock, /mentionCandidatesInflightRef\.current\.get\(sourceID\)/);
  assert.match(loaderBlock, /mentionCandidatesInflightRef\.current\.delete\(sourceID\)/);
});

test('chat detail sends friend cards without fetching profile during send', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/features/chat/screens/ChatDetailScreen.tsx'),
    'utf8',
  );
  const handlerBlock =
    source.match(/const handlePickFriend = useCallback\([\s\S]*?\n  \);/)?.[0] ??
    '';

  assert.doesNotMatch(source, /import \{ fetchUserProfile \}/);
  assert.doesNotMatch(handlerBlock, /fetchUserProfile/);
  assert.match(handlerBlock, /sendFriendCardMessage/);
});

test('chat detail guards async send UI state after unmount', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/features/chat/screens/ChatDetailScreen.tsx'),
    'utf8',
  );

  assert.match(source, /const mountedRef = useRef\(true\)/);
  assert.match(source, /mountedRef\.current = false/);
  for (const message of [
    '消息发送失败，请重试',
    '录音启动失败，请重试',
    '语音发送失败，请重试',
    '位置发送失败，请重试',
    '图片发送失败，请重试',
    '笔记发送失败，请重试',
    '名片发送失败，请重试',
    '收藏内容发送失败，请重试',
    '转账卡片发送失败，但积分已扣减',
  ]) {
    // These error strings are now i18n'd: setSendError(t('chat.detail.x', { defaultValue: '中文' })).
    // The message survives verbatim in the defaultValue, so anchor on that (or the older
    // direct / policy-aware forms) and still assert the mountedRef guard precedes it.
    const direct = `setSendError('${message}')`;
    const policyAware = `setSendError(getChatSendErrorMessage(error, '${message}'))`;
    const i18nForm = `defaultValue: '${message}'`;
    let index = source.indexOf(direct);
    if (index === -1) index = source.indexOf(policyAware);
    if (index === -1) index = source.indexOf(i18nForm);
    assert.notEqual(index, -1, `${message} missing`);
    // The i18n wrapper puts the string a few lines below the guard, so widen the lookback.
    const guardWindow = source.slice(Math.max(0, index - 320), index);
    assert.match(guardWindow, /mountedRef\.current/, `${message} should be mounted-guarded`);
  }
  assert.match(source, /if \(mountedRef\.current\) setVoiceActionBusy\(false\)/);
  assert.match(source, /if \(mountedRef\.current\) setCancelArmed\(false\)/);
  assert.match(source, /if \(mountedRef\.current\) setDraft\(''\)/);
  assert.match(source, /if \(mountedRef\.current\) setSending\(false\)/);
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

test('chat detail snapshots voice file uri before stopping the native recorder', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/chat/screens/ChatDetailScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.doesNotMatch(source, /statusAfterStop/);
  assert.match(
    source,
    /const statusBeforeStop = voiceRecorder\.getStatus\(\);\s*\n\s*const soundPath = voiceRecorder\.uri \?\? statusBeforeStop\.url;\s*\n\s*await voiceRecorder\.stop\(\);/,
  );
});

test('chat detail cancels a pending async voice start when the user releases early', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/chat/screens/ChatDetailScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /voicePressActiveRef/);
  assert.match(source, /voiceRecordSessionRef/);
  assert.match(source, /const recordSession = \+\+voiceRecordSessionRef\.current/);
  assert.match(source, /recordSession !== voiceRecordSessionRef\.current/);
  assert.match(source, /restoreRecordingAudioMode\(\);[\s\S]*return;/);
});

test('chat detail serializes async voice starts so stale sessions cannot tear down a newer recording', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/features/chat/screens/ChatDetailScreen.tsx'),
    'utf8',
  );

  assert.match(source, /voiceStartInProgressRef/);
  assert.match(source, /voiceStartInProgressRef\.current = true/);
  assert.match(source, /voiceStartInProgressRef\.current = false/);
  assert.match(
    source,
    /if \(!voicePressActiveRef\.current \|\| recordSession !== voiceRecordSessionRef\.current\) \{\s*return;\s*\}\s*await setAudioModeAsync/,
  );
  assert.match(
    source,
    /recordingAudioModeSessionRef\.current = recordSession;\s*if \(!voicePressActiveRef\.current \|\| recordSession !== voiceRecordSessionRef\.current\) \{\s*restoreRecordingAudioMode\(\);/,
  );
  assert.match(source, /recordingAudioModeSessionRef\.current === recordSession/);
  const finishBeforeEarlyReturn = source.match(
    /const finishHoldRecording = useCallback[\s\S]*?if \(!isRecordingRef\.current && voiceRecordingStartedAt == null\)/,
  )?.[0] ?? '';
  assert.doesNotMatch(finishBeforeEarlyReturn, /voiceStartInProgressRef\.current = false/);
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

test('group call screen defers LiveKit imports until native modules are available', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/features/call/screens/GroupCallScreen.tsx'),
    'utf8',
  );

  assert.doesNotMatch(source, /from ['"]@livekit\/react-native['"]/);
  assert.match(source, /loadLiveKitModule/);
  assert.match(source, /NativeModules\.WebRTCModule/);
  assert.match(source, /LiveKit 通话组件不可用/);
});

test('root layout registers LiveKit only after the native WebRTC module exists', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'app/_layout.tsx'),
    'utf8',
  );

  assert.doesNotMatch(source, /from ['"]@livekit\/react-native['"]/);
  assert.match(source, /registerLiveKitGlobals/);
  assert.match(source, /NativeModules\.WebRTCModule/);
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

test('group member access stays live while the chat screen is mounted', () => {
  const screen = fs.readFileSync(
    path.join(process.cwd(), 'src/features/chat/screens/ChatDetailScreen.tsx'),
    'utf8',
  );
  const hook = fs.readFileSync(
    path.join(process.cwd(), 'src/features/chat/hooks/use-group-member-view-access.ts'),
    'utf8',
  );

  // 屏幕不再自持一次性快照，统一走活体权限 hook。
  assert.match(screen, /useGroupMemberViewAccess\(\{/);
  assert.doesNotMatch(screen, /setCanViewGroupMemberProfiles/);
  // hook 订阅自己的成员身份变化（降权/被移出/退群），卸载时解绑。
  assert.match(hook, /subscribeGroupMemberSelfChanges\(\s*groupID,\s*currentUserID/);
  assert.match(hook, /unsubscribe\(\);/);
  // revalidate 现场重查 fail-closed：查询失败/查无记录一律无权。
  assert.match(hook, /return canViewGroupMembers\(next\?\.roleLevel\);/);
  assert.match(hook, /catch \{[\s\S]{0,400}return false;/);
  // review R3：事件代际守——在途查询被角色事件超车时丢弃陈旧结果、按事件判定。
  assert.match(hook, /const eventGenRef = useRef\(0\)/);
  assert.match(hook, /if \(cancelled \|\| eventGenRef\.current !== genAtStart\) return;/);
  assert.match(hook, /return canViewGroupMembers\(lastEventMemberRef\.current\?\.roleLevel\);/);
});

test('protected member actions revalidate fail-closed at tap time', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/features/chat/screens/ChatDetailScreen.tsx'),
    'utf8',
  );

  // 打开消息发送者资料 / 发起群呼前都现场重查角色，不吃旧快照。
  const revalidations = source.match(/await revalidateMemberViewAccess\(\)/g) ?? [];
  assert.ok(
    revalidations.length >= 3,
    `expected sender/card/call paths to revalidate, got ${revalidations.length}`,
  );
  assert.match(
    source,
    /if \(!\(await revalidateMemberViewAccess\(\)\)\) \{\s*\n\s*Alert\.alert\(t\('chat\.call\.title'\), t\('chat\.groupMembersRestricted'\)\);/,
  );
});

test('shared friend cards of non-members stay openable for ordinary members', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/features/chat/screens/ChatDetailScreen.tsx'),
    'utf8',
  );

  // 名片只放行"确认不在本群"的目标；review R2：身份查不清（查询失败）一律
  // fail-closed 拦截，断网不能成为绕过成员目录限制的口子。
  assert.match(source, /const \[targetMember\] = await loadSpecifiedGroupMembers\(sourceID, \[\s*toImUserId\(userID\),\s*\]\);/);
  assert.match(source, /let blockTarget = true;/);
  assert.match(source, /blockTarget = Boolean\(targetMember\);/);
  assert.match(source, /catch \{\s*\n\s*blockTarget = true;/);
  assert.match(source, /if \(blockTarget\) \{\s*\n\s*Alert\.alert\(t\('chat\.groupMembersRestricted'\)\);/);
});

test('losing member access clears stale mention state before the next send', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/features/chat/screens/ChatDetailScreen.tsx'),
    'utf8',
  );

  // review R2：降权瞬间清空已选 @ 目标/候选/缓存——handleSend 不再把滞留的
  // mention（含 @所有人）发出去。
  assert.match(
    source,
    /if \(!isGroupChat \|\| canViewGroupMemberProfiles\) return;\s*\n\s*setMentionTargets\(\[\]\);\s*\n\s*setMentionCandidates\(\[\]\);\s*\n\s*setMentionQuery\(null\);\s*\n\s*setMentionPickerVisible\(false\);\s*\n\s*mentionCandidatesCacheRef\.current\.clear\(\);/,
  );
});
