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

  assert.match(source, /useChatInfoState|loadChatInfoState/);
  assert.match(source, /toggleConversationPinned|setConversationMute/);
  assert.match(source, /setConversationBurnDuration|clearConversationMessages/);
  assert.doesNotMatch(source, /const \[pinChat, setPinChat\] = useState\(false\)/);
});
