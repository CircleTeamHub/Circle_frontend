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
  assert.match(source, /conversationID/);
  assert.match(source, /buildChatInfoState\(\s*conversation\s*\)/);
  assert.match(source, /chatInfoState\.(pinned|muted|burnLabel)/);
  assert.match(source, /toggleValue={chatInfoState\.(pinned|muted)}/);
  assert.match(source, /rightText={chatInfoState\.burnLabel}/);
  assert.match(source, /onToggle={handleTogglePinned|handleToggleMute}/);
  assert.match(source, /onPress={handleClearConversationMessages|handleSetBurnDuration}/);
  assert.match(source, /toggleConversationPinned|setConversationMute/);
  assert.match(source, /setConversationBurnDuration|clearConversationMessages/);
  assert.doesNotMatch(source, /Alert\.alert\('暂未开放'/);
  assert.doesNotMatch(source, /openUnsupportedAction/);
  assert.doesNotMatch(source, /const \[pinChat, setPinChat\] = useState\(false\)/);
  assert.doesNotMatch(source, /const \[muteNotifications, setMuteNotifications\] = useState\(false\)/);
  assert.doesNotMatch(source, /const \[blacklist, setBlacklist\] = useState\(false\)/);
  assert.doesNotMatch(source, /toggleValue={pinChat}/);
  assert.doesNotMatch(source, /toggleValue={muteNotifications}/);
  assert.doesNotMatch(source, /toggleValue={blacklist}/);
  assert.doesNotMatch(source, /rightText="关闭"/);
});
