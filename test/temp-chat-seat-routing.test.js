const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('seat management entry points route to the temp chat list screen', () => {
  const messagesSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/messages/screens/MessagesScreen.tsx'),
    'utf8',
  );
  const contactsSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/contacts/screens/ContactsScreen.tsx'),
    'utf8',
  );

  assert.match(messagesSource, /id === "seatManagement"[\s\S]{0,120}router\.push\("\/\(tabs\)\/messages\/temp-chats"\)/);
  assert.doesNotMatch(messagesSource, /id === "scan" \|\| id === "seatManagement"/);
  assert.match(contactsSource, /id === 'seats'[\s\S]{0,120}router\.push\('\/\(tabs\)\/contacts\/seats'\)/);
});

test('temp chat list routes exist and share the same screen implementation', () => {
  const messagesRoute = path.join(
    process.cwd(),
    'app/(tabs)/messages/temp-chats.tsx',
  );
  const contactsRoute = path.join(
    process.cwd(),
    'app/(tabs)/contacts/seats.tsx',
  );

  assert.equal(fs.existsSync(messagesRoute), true);
  assert.equal(fs.existsSync(contactsRoute), true);
  assert.match(fs.readFileSync(messagesRoute, 'utf8'), /TempChatsScreen/);
  assert.match(fs.readFileSync(contactsRoute, 'utf8'), /TempChatsScreen/);
});

test('temp chat list screen exposes a plus action for creating rooms', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/features/messages/screens/TempChatsScreen.tsx'),
    'utf8',
  );

  assert.match(source, /createTempChat/);
  assert.match(source, /handleCreateRoom/);
  assert.match(source, /icon:\s*'add-outline'/);
  assert.match(source, /rightActions=/);
  assert.match(source, /creatingRoomRef/);
});
