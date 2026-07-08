const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

test('ChatMessage supports a system-notice variant', () => {
  const types = read('src/types/index.ts');
  assert.match(types, /'system-notice'/);
});

test('FriendAdded maps to a centered system notice before the drop-all filter', () => {
  const mappers = read('src/im/mappers.ts');
  // The FriendAdded branch must exist and produce a system-notice.
  assert.match(mappers, /MessageType\.FriendAdded/);
  assert.match(mappers, /type: 'system-notice'/);
  assert.match(mappers, /tImNotification\('friendAdded'/);

  // Ordering: the FriendAdded branch must come BEFORE the generic
  // `isSystemNotification(...) return null` filter, otherwise it gets dropped.
  const friendAddedIdx = mappers.indexOf('MessageType.FriendAdded');
  const dropFilterIdx = mappers.indexOf('if (isSystemNotification(item.contentType))');
  assert.ok(friendAddedIdx > -1 && dropFilterIdx > -1);
  assert.ok(
    friendAddedIdx < dropFilterIdx,
    'FriendAdded branch must precede the drop-all system-notification filter',
  );
});

test('chat screen renders the system-notice pill', () => {
  const screen = read('src/features/chat/screens/ChatDetailScreen.tsx');
  assert.match(screen, /SystemNoticePill/);
  assert.match(screen, /case 'system-notice':/);
});

test('SystemNoticePill component exists and is exported from the barrel', () => {
  const pill = read('src/features/chat/components/bubbles/system-notice-pill.tsx');
  assert.match(pill, /SystemNoticePill/);
  const barrel = read('src/features/chat/components/chat-bubble.tsx');
  assert.match(barrel, /SystemNoticePill/);
});

test('local friend-added notice: client wrapper inserts a local-only custom message', () => {
  const client = read('src/im/client.ts');
  assert.match(client, /FRIEND_ADDED_NOTICE_EXTENSION\s*=/);
  assert.match(client, /export async function insertLocalFriendAddedNotice/);
  assert.match(client, /insertSingleMessageToLocalStorage/);
  // Must be local-only — never routed through reportSend/sendMessage.
  const fnBody = client.slice(
    client.indexOf('export async function insertLocalFriendAddedNotice'),
    client.indexOf('export async function sendTransferCardMessage'),
  );
  assert.ok(
    !/reportSend|sendMessage/.test(fnBody),
    'insertLocalFriendAddedNotice must not send to the server',
  );
});

test('the local notice maps to a system-notice via its extension', () => {
  const mappers = read('src/im/mappers.ts');
  assert.match(mappers, /FRIEND_ADDED_NOTICE_EXTENSION/);
  assert.match(mappers, /ext === FRIEND_ADDED_NOTICE_EXTENSION/);
});

test('chat screen dedupes duplicate system notices (native + local)', () => {
  const screen = read('src/features/chat/screens/ChatDetailScreen.tsx');
  assert.match(screen, /seenSystemNotice/);
});

test('accept flow inserts the local notice best-effort', () => {
  const screen = read(
    'src/features/contacts/screens/FriendActivityDetailScreen.tsx',
  );
  assert.match(screen, /insertLocalFriendAddedNotice/);
  // Fire-and-forget so it never blocks/breaks the accept.
  assert.match(screen, /void insertLocalFriendAddedNotice/);
});

test('friendAdded notification string exists in every locale', () => {
  for (const locale of ['zh', 'en', 'ja', 'es', 'ko']) {
    const json = JSON.parse(read(`src/i18n/locales/${locale}.json`));
    const value = json?.im?.notification?.friendAdded;
    assert.equal(
      typeof value,
      'string',
      `${locale}.json is missing im.notification.friendAdded`,
    );
    assert.ok(value.length > 0, `${locale}.json friendAdded is empty`);
  }
});
