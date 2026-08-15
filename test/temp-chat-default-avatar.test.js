const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

test('GroupChatAvatar uses a scalable branded group illustration and optional clock badge', () => {
  const component = read('src/components/ui/group-chat-avatar.tsx');

  assert.match(component, /export function GroupChatAvatar/);
  assert.match(component, /uri && uri\.length > 0/);
  assert.match(component, /temporary \? \(/);
  assert.match(component, /LinearGradient/);
  assert.match(component, /name="time-outline"/);
  assert.match(component, /backgroundColor: '#FFC857'/);
  assert.match(component, /color="#5A3600"/);
  assert.match(component, /accessibilityRole="image"/);
  assert.match(component, /accessibilityLabel=\{name \|\| undefined\}/);
  assert.doesNotMatch(component, /require\(/);
});

test('all group conversation surfaces use the shared default avatar', () => {
  const surfaces = [
    'src/features/messages/screens/MessagesScreen.tsx',
    'src/features/messages/components/TempChatRow.tsx',
    'src/features/search/screens/SearchScreen.tsx',
    'src/features/chat/screens/ForwardPickerScreen.tsx',
    'src/features/chat/screens/ChatDetailScreen.tsx',
    'src/features/contacts/screens/GroupsScreen.tsx',
    'src/features/notes/components/ShareNoteSheet.tsx',
    'src/features/messages/screens/GroupManagementScreen.tsx',
  ];

  for (const rel of surfaces) {
    assert.match(read(rel), /GroupChatAvatar/, `${rel} 应使用 GroupChatAvatar`);
  }

  const forwardPicker = read(
    'src/features/chat/screens/ForwardPickerScreen.tsx',
  );
  assert.match(forwardPicker, /item\.type === 'GROUP' \|\| item\.type === 'TEMP'/);
});
