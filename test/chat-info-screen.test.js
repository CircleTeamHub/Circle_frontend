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

test('chat info screen constrains conversation actions with burn selection, clear confirmation, and pending guards', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/chat/screens/ChatInfoScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /const BURN_DURATION_OPTIONS = \[/);
  assert.match(source, /label: '关闭', duration: 0/);
  assert.match(source, /label: '10秒', duration: 10/);
  assert.match(source, /label: '1分钟', duration: 60/);
  assert.match(source, /label: '5分钟', duration: 300/);
  assert.match(source, /const PENDING_TEXT = '处理中';/);
  assert.match(source, /pin: false,\s*mute: false,\s*burn: false,\s*clear: false/s);
  assert.match(source, /Alert\.alert\(\s*'好友消息自毁',\s*'选择消息自毁时间'/s);
  assert.match(source, /Alert\.alert\(\s*'清空聊天记录',\s*'清空后将删除当前会话的聊天记录，且无法恢复。'/s);
  assert.match(source, /actionPending\.pin \? undefined : handleTogglePinned/);
  assert.match(source, /actionPending\.mute \? undefined : handleToggleMuted/);
  assert.match(source, /actionPending\.burn \? undefined : handleOpenBurnDurationPicker/);
  assert.match(source, /actionPending\.clear \? undefined : handleConfirmClearHistory/);
  assert.match(source, /hasToggle={!actionPending\.pin}/);
  assert.match(source, /hasToggle={!actionPending\.mute}/);
  assert.match(source, /rightText={actionPending\.burn \? PENDING_TEXT : burnLabel}/);
  assert.match(source, /rightText={actionPending\.clear \? PENDING_TEXT : undefined}/);
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
