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
    /conversations?\.find\(\s*\(\s*conversation\s*\)\s*=>\s*conversation\.sourceID\s*===\s*routeSourceID\s*\)/,
  );
  assert.match(
    source,
    /const resolvedConversationID = conversation\?\.conversationID \?\? conversationID;/,
  );
  assert.match(source, /conversationID/);
  assert.match(source, /buildChatInfoState\(\s*conversation\s*\)/);
  assert.match(source, /toggleValue={[^}]*pinned[^}]*}/);
  assert.match(source, /toggleValue={[^}]*muted[^}]*}/);
  assert.match(source, /rightText={[^}]*burnLabel[^}]*}/);
  assert.match(source, /label="置顶聊天"[\s\S]{0,260}toggleConversationPinned\(resolvedConversationID,/s);
  assert.match(source, /label="消息免打扰"[\s\S]{0,260}setConversationMute\(resolvedConversationID,/s);
  assert.match(source, /label="好友消息自毁"[\s\S]{0,360}setConversationBurnDuration\(\s*resolvedConversationID,/s);
  assert.match(source, /label="清空聊天记录"[\s\S]{0,260}clearConversationMessages\(resolvedConversationID\)/s);
  assert.doesNotMatch(source, /toggleConversationPinned\(conversationID,/);
  assert.doesNotMatch(source, /setConversationMute\(conversationID,/);
  assert.doesNotMatch(source, /setConversationBurnDuration\(conversationID,/);
  assert.doesNotMatch(source, /clearConversationMessages\(conversationID\)/);
  assert.doesNotMatch(source, /const \[pinChat, setPinChat\] = useState\(false\)/);
  assert.doesNotMatch(source, /const \[muteNotifications, setMuteNotifications\] = useState\(false\)/);
  assert.doesNotMatch(source, /toggleValue={pinChat}/);
  assert.doesNotMatch(source, /toggleValue={muteNotifications}/);
});
