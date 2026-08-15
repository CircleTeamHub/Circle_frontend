const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

test('TempChatAvatar uses a scalable branded group illustration and clock badge', () => {
  const component = read('src/components/ui/temp-chat-avatar.tsx');

  assert.match(component, /export function TempChatAvatar/);
  assert.match(component, /LinearGradient/);
  assert.match(component, /name="time-outline"/);
  assert.match(component, /backgroundColor: '#FFC857'/);
  assert.match(component, /color="#5A3600"/);
  assert.match(component, /accessibilityRole="image"/);
  assert.match(component, /accessibilityLabel=\{name \|\| undefined\}/);
  assert.doesNotMatch(component, /require\(/);
});

test('all TempChat conversation surfaces use the shared default avatar', () => {
  const surfaces = [
    'src/features/messages/screens/MessagesScreen.tsx',
    'src/features/messages/components/TempChatRow.tsx',
    'src/features/search/screens/SearchScreen.tsx',
    'src/features/chat/screens/ForwardPickerScreen.tsx',
    'src/features/chat/screens/ChatDetailScreen.tsx',
  ];

  for (const rel of surfaces) {
    assert.match(read(rel), /TempChatAvatar/, `${rel} 应使用 TempChatAvatar`);
  }

  const forwardPicker = read(
    'src/features/chat/screens/ForwardPickerScreen.tsx',
  );
  assert.match(forwardPicker, /item\.type === 'GROUP' \|\| item\.type === 'TEMP'/);
});
