const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

const MESSAGE_TYPE = {
  CustomMessage: 110,
  TypingMessage: 113,
  FriendAdded: 1201,
};
const FRIEND_ADDED_NOTICE_EXTENSION = 'friend-added-notice-v1';

function loadMappers() {
  const filePath = path.join(process.cwd(), 'src/im/mappers.ts');
  const transpiled = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;
  const context = {
    module: { exports: {} },
    exports: {},
    require: (specifier) => {
      if (specifier === '@openim/rn-client-sdk') {
        return { MessageType: MESSAGE_TYPE, SessionType: { Group: 2 } };
      }
      if (specifier === '@/im/client') {
        return {
          NOTE_CARD_EXTENSION: 'note-card-v1',
          TRANSFER_CARD_EXTENSION: 'transfer-card-v1',
          VERIFICATION_CARD_EXTENSION: 'circle-verify-v1',
          FRIEND_ADDED_NOTICE_EXTENSION,
          fromImUserId: (id) => id,
        };
      }
      if (specifier === '@/services/api/utils') {
        return { normalizeMediaUrl: (url) => url };
      }
      if (specifier === '@/i18n') {
        return {
          __esModule: true,
          default: {
            language: 'en',
            t: (_key, options) => options.defaultValue,
          },
        };
      }
      if (specifier === '@/utils/locale') {
        return { getLocalizedDateTimeLocale: () => 'en-US' };
      }
      throw new Error(`Unexpected import: ${specifier}`);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

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
  assert.match(mappers, /systemNoticeKind: 'friend-added'/);
});

test('friend-added dedupe pairs actual mapped native/local events within a bounded window', async () => {
  const { mapMessageItemToChatMessage } = loadMappers();
  const { collapseDuplicateFriendAddedNotices } = await import(
    '../src/features/chat/utils/system-notice-dedupe.ts'
  );
  const mapNative = (id, sendTime) =>
    mapMessageItemToChatMessage(
      { clientMsgID: id, contentType: MESSAGE_TYPE.FriendAdded, sendTime },
      null,
    );
  const mapLocal = (id, sendTime) =>
    mapMessageItemToChatMessage(
      {
        clientMsgID: id,
        contentType: MESSAGE_TYPE.CustomMessage,
        sendTime,
        sendID: 'self',
        customElem: { extension: FRIEND_ADDED_NOTICE_EXTENSION },
      },
      'self',
    );

  const newestNative = mapNative('native-new', 1_000_000);
  const pairedLocal = mapLocal('local-new', 999_000);
  assert.equal(newestNative.systemNoticeSource, 'native');
  assert.equal(newestNative.systemNoticeTimestamp, 1_000_000);
  assert.equal(pairedLocal.systemNoticeSource, 'local');
  assert.equal(pairedLocal.systemNoticeTimestamp, 999_000);

  assert.deepEqual(
    collapseDuplicateFriendAddedNotices([newestNative, pairedLocal]).map(
      (message) => message.id,
    ),
    ['native-new'],
  );

  const olderNative = mapNative('native-old', 100_000);
  const olderLocal = mapLocal('local-old', 99_000);
  assert.deepEqual(
    collapseDuplicateFriendAddedNotices([
      newestNative,
      pairedLocal,
      olderNative,
      olderLocal,
    ]).map((message) => message.id),
    ['native-new', 'native-old'],
  );

  assert.deepEqual(
    collapseDuplicateFriendAddedNotices([
      mapNative('native-unpaired', 3_000_000),
      mapLocal('local-unpaired', 2_600_000),
    ]).map((message) => message.id),
    ['native-unpaired', 'local-unpaired'],
  );

  const sameSource = [
    mapNative('native-a', 2_000_000),
    mapNative('native-b', 1_999_000),
  ];
  const ordinaryAndIncomplete = [
    { id: 'group-1', type: 'system-notice', text: newestNative.text },
    { id: 'group-2', type: 'system-notice', text: newestNative.text },
    {
      id: 'missing-time',
      type: 'system-notice',
      text: newestNative.text,
      systemNoticeKind: 'friend-added',
      systemNoticeSource: 'local',
    },
    {
      id: 'missing-source',
      type: 'system-notice',
      text: newestNative.text,
      systemNoticeKind: 'friend-added',
      systemNoticeTimestamp: 1_999_000,
    },
  ];

  assert.deepEqual(
    collapseDuplicateFriendAddedNotices([
      ...sameSource,
      ...ordinaryAndIncomplete,
    ]).map((message) => message.id),
    [
      'native-a',
      'native-b',
      'group-1',
      'group-2',
      'missing-time',
      'missing-source',
    ],
  );
});

test('chat screen wires mapped messages through friend-added dedupe', () => {
  const screen = read('src/features/chat/screens/ChatDetailScreen.tsx');
  assert.match(screen, /collapseDuplicateFriendAddedNotices\(mapped\)/);
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
