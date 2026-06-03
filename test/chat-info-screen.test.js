const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('chat info screen uses real conversation state instead of local placeholder toggles', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/chat/screens/ChatInfoScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /useIMStore\(\(state\) => state\.conversations\)/);
  assert.match(
    source,
    /conversations?\.find\(\s*\(\s*conversation\s*\)\s*=>\s*conversation\.conversationID\s*===\s*conversationID\s*\)/,
  );
  assert.match(source, /const routeSourceID = friendId;/);
  assert.match(
    source,
    /conversations?\.find\(\s*\(\s*conversation\s*\)\s*=>[\s\S]{0,120}conversation\.userID\s*===\s*routeSourceID\s*\|\|\s*conversation\.groupID\s*===\s*routeSourceID[\s\S]{0,40}\)/,
  );
  assert.doesNotMatch(source, /conversation\.sourceID\s*===\s*routeSourceID/);
  assert.match(
    source,
    /const resolvedConversationID = conversation\?\.conversationID \?\? '';/,
  );
  assert.doesNotMatch(
    source,
    /const resolvedConversationID = conversation\?\.conversationID \?\? conversationID;/,
  );
  assert.match(source, /conversationID/);
  assert.match(source, /buildChatInfoState\(\s*conversation\s*\)/);
  assert.match(source, /toggleValue={[^}]*pinned[^}]*}/);
  assert.match(source, /toggleValue={[^}]*muted[^}]*}/);
  assert.match(source, /burnLabel/);
  assert.match(source, /const handleTogglePinned = useCallback/);
  assert.match(source, /toggleConversationPinned\(resolvedConversationID,\s*nextPinned\)/);
  assert.match(source, /const handleToggleMuted = useCallback/);
  assert.match(source, /setConversationMute\(resolvedConversationID,\s*nextMuted\)/);
  assert.match(source, /const applyBurnDuration = useCallback/);
  assert.match(source, /setConversationBurnDuration\(resolvedConversationID,\s*nextBurnDuration\)/);
  assert.match(source, /const handleConfirmClearHistory = useCallback/);
  assert.match(source, /clearConversationMessages\(resolvedConversationID\)/);
  assert.doesNotMatch(source, /toggleConversationPinned\(conversationID,/);
  assert.doesNotMatch(source, /setConversationMute\(conversationID,/);
  assert.doesNotMatch(source, /setConversationBurnDuration\(conversationID,/);
  assert.doesNotMatch(source, /clearConversationMessages\(conversationID\)/);
  assert.doesNotMatch(source, /const \[pinChat, setPinChat\] = useState\(false\)/);
  assert.doesNotMatch(source, /const \[muteNotifications, setMuteNotifications\] = useState\(false\)/);
  assert.doesNotMatch(source, /toggleValue={pinChat}/);
  assert.doesNotMatch(source, /toggleValue={muteNotifications}/);
});

test('chat info screen renders compact unified display icons', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/chat/screens/ChatInfoScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /UserIconRow/);
  assert.match(source, /compact/);
  assert.match(source, /displayIcons/);
});

test('chat info screen renders a dedicated group info layout for group conversations', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/chat/screens/ChatInfoScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /isGroupConversation/);
  assert.match(source, /loadGroupMemberList/);
  assert.match(source, /getGroupInfo/);
  assert.match(source, /groupMembers\.slice\(0,\s*19\)/);
  assert.match(source, /groupMemberGrid/);
  assert.match(source, /groupNameText/);
  assert.match(source, /t\('chat\.groupName'\)/);
  assert.match(source, /t\('chat\.groupNotice'\)/);
  assert.match(source, /t\('chat\.searchHistory'\)/);
  assert.match(source, /t\('chat\.moreGroupMembers'/);
  assert.match(source, /rightIcon="search-outline"/);
});

test('chat info screen gives group rows real actions instead of unsupported placeholders', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/chat/screens/ChatInfoScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /title=\{t\('chat\.groupInfo'\)\}/);
  assert.match(source, /handleEditGroupName/);
  assert.match(source, /updateGroupName\(groupID,\s*trimmed\)/);
  assert.match(source, /handleEditGroupNotice/);
  assert.match(source, /updateGroupNotice\(groupID,\s*trimmed\)/);
  assert.match(source, /handleEditMyGroupAlias/);
  assert.match(source, /updateGroupMemberAlias\(groupID,\s*currentUserID,\s*trimmed\)/);
  assert.match(source, /handleMinimizeGroupChat/);
  assert.match(source, /hideConversation\(resolvedConversationID\)/);
  assert.match(source, /handleSaveGroupToContacts/);
  assert.match(source, /setConversationExtension\(resolvedConversationID,\s*\{\s*saveGroupToContacts: nextValue\s*\}/);
  assert.match(source, /handleResetGroupNotifyMessages/);
  assert.match(source, /resetConversationGroupAtType\(resolvedConversationID\)/);
  assert.match(source, /handleOpenGroupReport/);
  assert.match(source, /groupID/);
  assert.doesNotMatch(source, /handleOpenUnsupportedGroupAction/);
});

test('chat info screen opens a contact picker when adding group members', () => {
  const infoPath = path.join(
    process.cwd(),
    'src/features/chat/screens/ChatInfoScreen.tsx',
  );
  const routePath = path.join(
    process.cwd(),
    'app/(tabs)/messages/invite-group-members.tsx',
  );
  const layoutPath = path.join(
    process.cwd(),
    'app/(tabs)/messages/_layout.tsx',
  );
  const screenPath = path.join(
    process.cwd(),
    'src/features/messages/screens/InviteGroupMembersScreen.tsx',
  );
  const infoSource = fs.readFileSync(infoPath, 'utf8');
  const layoutSource = fs.readFileSync(layoutPath, 'utf8');

  assert.match(infoSource, /handleOpenInviteGroupMembers/);
  assert.match(infoSource, /pathname: '\/\(tabs\)\/messages\/invite-group-members'/);
  assert.match(infoSource, /groupID/);
  assert.match(infoSource, /groupTitle/);
  assert.doesNotMatch(infoSource, /promptForText\(t\('chat\.addGroupMember'\)/);
  assert.match(layoutSource, /<Stack\.Screen name="invite-group-members" \/>/);
  assert.equal(fs.existsSync(routePath), true);
  assert.equal(fs.existsSync(screenPath), true);
});

test('invite group members screen filters users who are already in the group', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/messages/screens/InviteGroupMembersScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /loadGroupMemberList\(groupID,\s*10_000\)/);
  assert.match(source, /const \[existingMemberIDs, setExistingMemberIDs\]/);
  assert.match(source, /members\.map\(\(member\) => toImUserId\(member\.userID\)\)/);
  assert.match(source, /friends\.filter\([\s\S]{0,120}!existingMemberIDs\.has\(toImUserId\(friend\.id\)\)/);
  assert.match(source, /filter\(\(userID\) => !existingMemberIDs\.has\(userID\)\)/);
  assert.match(source, /inviteGroupMembersAlreadyMembers/);
  assert.match(source, /inviteGroupMembersNoInvitableFriends/);
  assert.doesNotMatch(source, /inviteUsersToGroup\(groupID,\s*selectedIds\.map\(toImUserId\)\)/);
});

test('OpenIM client does not import native filesystem at module load on web', () => {
  const checkedFiles = [
    'src/im/client.ts',
    'src/services/api/upload.ts',
    'src/services/cache/clear-app-cache.ts',
  ];

  for (const relativePath of checkedFiles) {
    const source = fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

    assert.doesNotMatch(source, /import\s+RNFS\s+from\s+['"]react-native-fs['"]/);
    assert.match(source, /import\('react-native-fs'\)/);
    assert.match(source, /loadNativeFS/);
  }
});

test('i18n avoids synchronous storage reads during web server rendering', () => {
  const filePath = path.join(process.cwd(), 'src/i18n/index.ts');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /function canUseSynchronousStorage\(\)/);
  assert.match(source, /typeof window !== 'undefined'/);
  assert.match(source, /if \(!canUseSynchronousStorage\(\)\) \{\s*return getDeviceLanguage\(\);\s*\}/s);
  assert.match(source, /if \(canUseSynchronousStorage\(\)\) \{\s*storage\.set\(LANGUAGE_KEY, lang\);/s);
  assert.match(source, /if \(!canUseSynchronousStorage\(\)\) \{\s*return;\s*\}/s);
});

test('note block editor defers DOM editor imports during web server rendering', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/notes/components/NoteBlockEditor.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.doesNotMatch(source, /import\s+NoteBlockEditorDOM\s+from/);
  assert.match(source, /function canLoadDOMEditor\(\)/);
  assert.match(source, /Platform\.OS !== 'web' \|\| typeof window !== 'undefined'/);
  assert.match(source, /require\('@\/features\/notes\/dom\/NoteBlockEditor\.dom'\)/);
  assert.match(source, /if \(!canLoadDOMEditor\(\)\) \{\s*return <View style=\{s\.container\} \/>;\s*\}/s);
});

test('chat info screen constrains conversation actions with burn selection, clear confirmation, and pending guards', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/chat/screens/ChatInfoScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /const burnDurationOptions = useMemo\(/);
  assert.match(source, /label: t\('chat\.burnOff'\), duration: 0/);
  assert.match(source, /label: t\('chat\.burn10s'\), duration: 10/);
  assert.match(source, /label: t\('chat\.burn1m'\), duration: 60/);
  assert.match(source, /label: t\('chat\.burn5m'\), duration: 300/);
  assert.match(source, /t\('chat\.pending'\)/);
  assert.match(source, /pin: false,\s*mute: false,\s*burn: false,\s*clear: false/s);
  assert.match(source, /Alert\.alert\(\s*t\('chat\.burnMessage'\),\s*t\('chat\.selectBurnTime'\)/s);
  assert.match(source, /Alert\.alert\(\s*t\('chat\.clearHistory'\),\s*t\('chat\.clearHistoryWarning'\)/s);
  assert.match(source, /actionPending\.pin \? undefined : handleTogglePinned/);
  assert.match(source, /actionPending\.mute \? undefined : handleToggleMuted/);
  assert.match(source, /actionPending\.burn \? undefined : handleOpenBurnDurationPicker/);
  assert.match(source, /actionPending\.clear \? undefined : handleConfirmClearHistory/);
  assert.match(source, /hasToggle={!actionPending\.pin}/);
  assert.match(source, /hasToggle={!actionPending\.mute}/);
  assert.match(source, /rightText={actionPending\.burn \? t\('chat\.pending'\) : burnLabel}/);
  assert.match(source, /rightText={actionPending\.clear \? t\('chat\.pending'\) : undefined}/);
});

test('chat info screen reconciles optimistic conversation state after live updates catch up', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/chat/screens/ChatInfoScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /const hasOptimisticConversationState =/);
  assert.match(source, /useEffect\(\(\) => \{/);
  assert.match(source, /if \(!hasOptimisticConversationState\) \{/);
  assert.match(source, /const nextState = \{ \.\.\.current \};/);
  assert.match(source, /if \(current\.pinned !== undefined && current\.pinned === baseState\.pinned\) \{/);
  assert.match(source, /delete nextState\.pinned;/);
  assert.match(source, /if \(current\.muted !== undefined && current\.muted === baseState\.muted\) \{/);
  assert.match(source, /delete nextState\.muted;/);
  assert.match(source, /if \([\s\S]{0,120}current\.burnDuration !== undefined &&[\s\S]{0,120}current\.burnDuration === \(conversation\?\.burnDuration \?\? 0\)/);
  assert.match(source, /delete nextState\.burnDuration;/);
  assert.match(source, /return nextState;/);
});

test('chat info screen applies optimistic pin and mute updates only after the ref-based guard claims the action', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/chat/screens/ChatInfoScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /const runConversationAction = useCallback/);
  assert.match(source, /setConversationActionPending\(action, true\);[\s\S]{0,120}await task\(\);/);
  assert.match(source, /void runConversationAction\(\s*'pin',[\s\S]{0,120}setOptimisticConversationState\(\(current\) => \(\{/);
  assert.match(source, /void runConversationAction\(\s*'mute',[\s\S]{0,120}setOptimisticConversationState\(\(current\) => \(\{/);
  assert.doesNotMatch(source, /const previousPinned = pinned;[\s\S]{0,120}setOptimisticConversationState\(\(current\) => \(\{[\s\S]{0,80}pinned: nextPinned/);
  assert.doesNotMatch(source, /const previousMuted = muted;[\s\S]{0,120}setOptimisticConversationState\(\(current\) => \(\{[\s\S]{0,80}muted: nextMuted/);
});

test('chat info screen rollback drops optimistic overrides instead of restoring stale snapshots', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/chat/screens/ChatInfoScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /const dropOptimisticConversationStateKey = useCallback/);
  assert.match(source, /if \(current\[key\] === undefined\) \{/);
  assert.match(source, /delete nextState\[key\];/);
  assert.match(source, /void runConversationAction\(\s*'pin',[\s\S]{0,400}dropOptimisticConversationStateKey\('pinned'\)/);
  assert.match(source, /void runConversationAction\(\s*'mute',[\s\S]{0,400}dropOptimisticConversationStateKey\('muted'\)/);
  assert.match(source, /void runConversationAction\(\s*'burn',[\s\S]{0,400}dropOptimisticConversationStateKey\('burnDuration'\)/);
  assert.doesNotMatch(source, /pinned: previousPinned/);
  assert.doesNotMatch(source, /muted: previousMuted/);
  assert.doesNotMatch(source, /burnDuration: previousBurnDuration/);
});

test('chat info screen ignores stale async completions after the conversation changes', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/chat/screens/ChatInfoScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /const currentConversationIDRef = useRef\(''\);/);
  assert.match(source, /const resolvedConversationID = conversation\?\.conversationID \?\? '';\s*currentConversationIDRef\.current = resolvedConversationID;/s);
  assert.match(source, /currentConversationIDRef\.current = resolvedConversationID;/);
  assert.match(source, /const isActionConversationCurrent = useCallback/);
  assert.match(source, /currentConversationIDRef\.current === conversationID/);
  assert.match(source, /const actionConversationID = resolvedConversationID;/);
  assert.match(source, /if \(\s*isActionConversationCurrent\(actionConversationID\) &&[\s\S]{0,120}isLatestActionRequest\(action, actionRequestToken\)\s*\) \{\s*rollback\?\.?\(\);/s);
  assert.match(source, /if \(\s*isActionConversationCurrent\(actionConversationID\) &&[\s\S]{0,120}isLatestActionRequest\(action, actionRequestToken\)\s*\) \{\s*setConversationActionPending\(action, false\);/s);
  assert.doesNotMatch(source, /useEffect\(\(\) => \{\s*currentConversationIDRef\.current = resolvedConversationID;/s);
});

test('chat info screen only lets the latest request for an action finish cleanup', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/chat/screens/ChatInfoScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /const actionRequestTokenRef = useRef\(\{\s*pin: 0,\s*mute: 0,\s*burn: 0,\s*clear: 0,\s*\}\);/s);
  assert.match(source, /const startActionRequest = useCallback/);
  assert.match(source, /const nextToken = actionRequestTokenRef\.current\[action\] \+ 1;/);
  assert.match(source, /actionRequestTokenRef\.current = \{\s*\.\.\.actionRequestTokenRef\.current,\s*\[action\]: nextToken,\s*\};/s);
  assert.match(source, /return nextToken;/);
  assert.match(source, /const isLatestActionRequest = useCallback/);
  assert.match(source, /actionRequestTokenRef\.current\[action\] === requestToken/);
  assert.match(source, /const actionRequestToken = startActionRequest\(action\);/);
  assert.match(source, /if \(\s*isActionConversationCurrent\(actionConversationID\) &&\s*isLatestActionRequest\(action, actionRequestToken\)\s*\) \{\s*rollback\?\.?\(\);/s);
  assert.match(source, /if \(\s*isActionConversationCurrent\(actionConversationID\) &&\s*isLatestActionRequest\(action, actionRequestToken\)\s*\) \{\s*setConversationActionPending\(action, false\);/s);
});

test('chat info screen wires chat background selection into the new route and label', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/chat/screens/ChatInfoScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /getChatBackgroundHref/);
  assert.match(source, /useChatPreferencesStore/);
  assert.match(source, /backgroundLabel/);
  assert.match(source, /handleOpenChatBackground/);
  assert.match(source, /label=\{t\('chat\.chatBackground'\)\}/);
  assert.match(source, /rightText={backgroundLabel}/);
  assert.match(source, /onPress={handleOpenChatBackground}/);
});

test('chat info screen wires recommend-friend navigation from the friend recommendation row', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/chat/screens/ChatInfoScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /getRecommendFriendHref/);
  assert.match(source, /const handleOpenRecommendFriend = useCallback/);
  assert.match(source, /router\.push\(\s*getRecommendFriendHref\(/);
  assert.match(source, /label=\{t\('chat\.recommendFriend'\)\}/);
  assert.match(source, /onPress={handleOpenRecommendFriend}/);
  assert.doesNotMatch(source, /openUnsupportedAction\(t\('chat\.recommendFriend'\)\)/);
});

test('chat info screen wires search-history navigation from the new row', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/chat/screens/ChatInfoScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /getChatHistorySearchHubHref/);
  assert.match(source, /getOrCreateSingleConversation/);
  assert.match(source, /const resolveConversationIDForNavigation = useCallback/);
  assert.match(source, /const existingConversationID = resolvedConversationID\.trim\(\);/);
  assert.match(source, /const conversation = await getOrCreateSingleConversation\(friendId\);/);
  assert.match(source, /return conversation\.conversationID;/);
  assert.match(source, /const handleOpenSearchHistory = useCallback/);
  assert.match(source, /const nextConversationID = await resolveConversationIDForNavigation\(\);/);
  assert.match(source, /if \(!nextConversationID\) \{\s*return;\s*\}/s);
  assert.match(source, /router\.push\(\s*getChatHistorySearchHubHref\(/);
  assert.match(source, /label=\{t\('chat\.searchHistory'\)\}/);
  assert.match(source, /onPress={handleOpenSearchHistory}/);
});

test('chat info screen resolves back navigation from the explicit origin instead of the current stack state', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/chat/screens/ChatInfoScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /originScope\?: string;/);
  assert.match(source, /const originScope =/);
  assert.match(source, /getUserProfileHref/);
  assert.match(source, /const backHref = useMemo/);
  assert.match(source, /originScope === 'messages'/);
  assert.match(source, /getChatDetailHref\(/);
  assert.match(source, /getUserProfileHref\(originScope, friendId, friendName\)/);
  assert.match(source, /<NavHeader[\s\S]{0,200}fallbackHref=\{backHref\}/s);
  assert.doesNotMatch(source, /<NavHeader[\s\S]{0,200}onBackPress=/s);
});

test('messages layout registers chat history search routes', () => {
  const filePath = path.join(
    process.cwd(),
    "app/(tabs)/messages/_layout.tsx",
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /<Stack\.Screen name="chat-history-search" \/>/);
  assert.match(source, /<Stack\.Screen name="chat-history-text" \/>/);
  assert.match(source, /<Stack\.Screen name="chat-history-media" \/>/);
  assert.match(source, /<Stack\.Screen name="chat-history-files" \/>/);
  assert.match(source, /<Stack\.Screen name="chat-history-date" \/>/);
});

test('chat history search screens exist with dedicated titles and empty states', () => {
  const hubSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/chat/screens/ChatHistorySearchHubScreen.tsx'),
    'utf8',
  );
  const textSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/chat/screens/ChatHistoryTextScreen.tsx'),
    'utf8',
  );
  const mediaSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/chat/screens/ChatHistoryMediaScreen.tsx'),
    'utf8',
  );
  const filesSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/chat/screens/ChatHistoryFilesScreen.tsx'),
    'utf8',
  );
  const dateSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/chat/screens/ChatHistoryDateScreen.tsx'),
    'utf8',
  );

  assert.match(hubSource, /NavHeader[\s\S]*title="查找聊天记录"/);
  assert.match(hubSource, /fallbackHref={getChatDetailHref\(sourceID, title, undefined, conversationID\)}/);
  assert.match(hubSource, /搜索文字消息/);
  assert.match(hubSource, /图片/);
  assert.match(hubSource, /文件/);
  assert.match(hubSource, /按日期/);

  assert.match(textSource, /searchConversationTextMessages/);
  assert.match(textSource, /暂无匹配的聊天记录/);

  assert.match(mediaSource, /searchConversationMediaMessages/);
  assert.match(mediaSource, /暂无图片或视频记录/);

  assert.match(filesSource, /searchConversationFileMessages/);
  assert.match(filesSource, /暂无文件记录/);

  assert.match(dateSource, /searchConversationMessagesByDate/);
  assert.match(dateSource, /请选择日期/);
});
