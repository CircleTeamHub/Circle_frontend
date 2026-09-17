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

function load({ os = 'android', notifications = fakeNotifications() } = {}) {
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
