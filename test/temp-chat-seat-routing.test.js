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
  assert.match(
    contactsSource,
    /id: 'new-friends'[\s\S]*id: 'groups'[\s\S]*id: 'seats'[\s\S]*id: 'circles'/,
  );
});

test('the app presents the former seat feature as temporary group chats', () => {
  const zh = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'src/i18n/locales/zh.json'), 'utf8'),
  );

  assert.equal(zh.messages.seatManagement, '临时群聊');
  assert.equal(zh.contacts.seats, '临时群聊');
  assert.equal(zh.tempChats.title, '临时群聊');
  assert.equal(zh.tempChats.refresh, '刷新临时群聊列表');
  assert.doesNotMatch(JSON.stringify(zh), /坐席/);
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
