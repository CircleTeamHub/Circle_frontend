const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// 聊天通知在设备上的一半:安卓渠道 + 读过/撤回/焚毁后收起通知。
// 用真模块跑在 vm 里,expo-notifications 换成记账替身。
const root = process.cwd();
const BACKEND_ROOT = process.env.CIRCLE_BE_PATH ?? path.join(root, '..', 'circle_be');
const BACKEND_CONSTANTS_PATH = path.join(BACKEND_ROOT, 'src/chat/chat.constants.ts');
const hasBackend = fs.existsSync(BACKEND_CONSTANTS_PATH);

function fakeNotifications(presented = []) {
  const calls = { channels: [], dismissed: [] };
  return {
    calls,
    module: {
      AndroidImportance: { HIGH: 4 },
      AndroidNotificationVisibility: { PRIVATE: 0 },
      setNotificationChannelAsync: async (id, channel) => {
        calls.channels.push({ id, channel });
        return null;
      },
      getPresentedNotificationsAsync: async () => presented,
      dismissNotificationAsync: async (identifier) => {
        calls.dismissed.push(identifier);
      },
    },
  };
}

function load({ os = 'android', notifications = fakeNotifications(), state = { messagesByConversation: {}, conversations: [] } } = {}) {
  const filePath = path.join(root, 'src/chat-core/chat-notifications.ts');
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filePath,
  }).outputText;
  const loads = { expoNotifications: 0 };
  const failures = [];
  const context = {
    Promise,
    Set,
    module: { exports: {} },
    exports: {},
    require: (request) => {
      if (request === 'react-native') return { Platform: { OS: os } };
      if (request === './store') return { useChatStore: { getState: () => state } };
      if (request === '@/i18n') return { __esModule: true, default: { t: (key) => key } };
      if (request === '@/observability/report-failure') {
        return { reportHandledFailure: (...args) => failures.push(args) };
      }
      if (request === 'expo-notifications') {
        loads.expoNotifications += 1;
        return notifications.module;
      }
      throw new Error(`unexpected require: ${request}`);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(output, context);
  return { api: context.module.exports, calls: notifications.calls, loads, failures };
}

function presented(identifier, data) {
  return { request: { identifier, content: { data } } };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('android gets a high-importance chat channel whose content stays private on the lock screen', async () => {
  const notifications = fakeNotifications();
  const { api, calls } = load({ notifications });
  await api.ensureChatNotificationChannel(notifications.module);
  assert.equal(calls.channels.length, 1);
  assert.equal(calls.channels[0].id, 'chat');
  assert.equal(calls.channels[0].channel.importance, 4);
  assert.equal(calls.channels[0].channel.lockscreenVisibility, 0);
  assert.equal(calls.channels[0].channel.name, 'notifications.chatChannelName');
  // Expo treats nonempty channel sound strings as custom raw-resource names.
  // Omitting sound keeps Android's constructor default without that warning.
  assert.equal(Object.hasOwn(calls.channels[0].channel, 'sound'), false);
});

test('reinitializing the chat channel does not reset an existing user mute', async () => {
  const notifications = fakeNotifications();
  const existing = { id: 'chat', sound: null, importance: 4, name: 'Old language' };
  let deletions = 0;
  notifications.module.deleteNotificationChannelAsync = async () => { deletions += 1; };
  notifications.module.setNotificationChannelAsync = async (id, channel) => {
    notifications.calls.channels.push({ id, channel });
    // Android permits renaming; sound on an existing channel is user-owned.
    existing.name = channel.name;
    return existing;
  };
  const { api } = load({ notifications });
  await api.ensureChatNotificationChannel(notifications.module);
  await api.ensureChatNotificationChannel(notifications.module);
  assert.equal(existing.sound, null);
  assert.equal(existing.name, 'notifications.chatChannelName');
  assert.equal(deletions, 0);
  assert.ok(notifications.calls.channels.every(({ channel }) => !Object.hasOwn(channel, 'sound')));
});

test('ios has no channels to create', async () => {
  const notifications = fakeNotifications();
  const { api, calls } = load({ os: 'ios', notifications });
  await api.ensureChatNotificationChannel(notifications.module);
  assert.deepEqual(calls.channels, []);
});

test('reading a conversation clears every chat notification of that conversation only', async () => {
  const notifications = fakeNotifications([
    presented('n1', { type: 'chat', conversationId: 'c1', messageId: 'm1' }),
    presented('n2', { type: 'chat', conversationId: 'c1', messageId: 'm2' }),
    presented('n3', { type: 'chat', conversationId: 'c2', messageId: 'm3' }),
    presented('n4', { type: 'moment', conversationId: 'c1' }),
    presented('n5', null),
  ]);
  const { api, calls } = load({ notifications });
  api.dismissChatNotifications('c1');
  await settle();
  await settle();
  assert.deepEqual([...calls.dismissed].sort(), ['n1', 'n2']);
});

test('a recall or burn clears just those messages', async () => {
  const notifications = fakeNotifications([
    presented('n1', { type: 'chat', conversationId: 'c1', messageId: 'm1' }),
    presented('n2', { type: 'chat', conversationId: 'c1', messageId: 'm2' }),
    presented('n3', { type: 'chat', conversationId: 'c1' }),
  ]);
  const { api, calls } = load({ notifications });
  api.dismissChatNotifications('c1', ['m2']);
  await settle();
  await settle();
  assert.deepEqual([...calls.dismissed], ['n2']);
});

test('a partial read preserves notifications above its height and unknown legacy notifications', async () => {
  const notifications = fakeNotifications([
    presented('read', { type: 'chat', conversationId: 'c1', messageId: 'm2', height: 2 }),
    presented('read-edge', { type: 'chat', conversationId: 'c1', messageId: 'm3', height: 3 }),
    presented('unread', { type: 'chat', conversationId: 'c1', messageId: 'm4', height: 4 }),
    presented('other', { type: 'chat', conversationId: 'c2', messageId: 'm-other', height: 1 }),
    presented('legacy-read', { type: 'chat', conversationId: 'c1', messageId: 'old-read' }),
    presented('legacy-unread', { type: 'chat', conversationId: 'c1', messageId: 'old-unread' }),
    presented('legacy-unknown', { type: 'chat', conversationId: 'c1', messageId: 'not-cached' }),
    presented('invalid-height', { type: 'chat', conversationId: 'c1', messageId: 'not-cached', height: '1' }),
    presented('last-known', { type: 'chat', conversationId: 'c1', messageId: 'last-known' }),
  ]);
  const { api, calls } = load({ notifications, state: {
    messagesByConversation: { c1: [{ id: 'old-read', height: 1 }, { id: 'old-unread', height: 8 }] },
    conversations: [{ id: 'c1', lastMessage: { id: 'last-known', height: 3 } }],
  } });
  api.dismissChatNotifications('c1', undefined, 3);
  await settle();
  await settle();
  assert.deepEqual([...calls.dismissed].sort(), ['last-known', 'legacy-read', 'read', 'read-edge']);
});

test('web never loads expo-notifications, and failures are reported instead of thrown', async () => {
  const web = load({ os: 'web' });
  web.api.dismissChatNotifications('c1');
  await settle();
  assert.equal(web.loads.expoNotifications, 0);

  const broken = fakeNotifications();
  broken.module.getPresentedNotificationsAsync = async () => {
    throw new Error('native module missing');
  };
  const failing = load({ notifications: broken });
  failing.api.dismissChatNotifications('c1');
  await settle();
  await settle();
  assert.equal(failing.failures.length, 1);
  assert.equal(failing.failures[0][1], 'dismissChatNotifications');
});

test(
  'the channel id matches the one the backend puts on chat pushes',
  { skip: !hasBackend && 'circle_be not checked out beside circle-im' },
  () => {
    const backend = fs.readFileSync(BACKEND_CONSTANTS_PATH, 'utf8');
    const frontend = fs.readFileSync(
      path.join(root, 'src/chat-core/chat-notifications.ts'),
      'utf8',
    );
    const backendId = /export const CHAT_PUSH_CHANNEL_ID = '([^']+)'/.exec(backend)?.[1];
    const frontendId = /export const CHAT_NOTIFICATION_CHANNEL_ID = '([^']+)'/.exec(
      frontend,
    )?.[1];
    assert.ok(backendId, 'backend CHAT_PUSH_CHANNEL_ID not found');
    assert.equal(frontendId, backendId);
  },
);
