const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// 角标同步订阅了整个 chat store:「正在输入」「在线」「已送达」这类事件每次都会触发。
// 群一多,每次都整表求和很浪费 —— 会话列表没变时应直接复用结果。
function loadBadge() {
  const chatListeners = [];
  let sums = 0;
  const applied = [];
  const assistantApplied = [];
  const chatState = { conversations: [{ id: 'a', unreadCount: 2 }] };
  const badge = loadTsModule('src/chat-core/app-badge.ts', {
    requireShim: (request) => {
      if (request === 'react-native') return { Platform: { OS: 'web' } };
      if (request === 'expo-notifications') return { setBadgeCountAsync: async () => true };
      if (request === '@/stores/tabBadgeStore') {
        return {
          useTabBadgeStore: {
            getState: () => ({
              setMessagesUnread: (n) => applied.push(n),
              setAssistantUnread: (n) => assistantApplied.push(n),
            }),
          },
        };
      }
      if (request === './store') {
        return {
          selectTotalUnread: (state) => {
            sums += 1;
            return state.conversations
              .filter((c) => c.type !== 'SUPPORT')
              .reduce((total, c) => total + c.unreadCount, 0);
          },
          selectAssistantUnread: (state) => state.conversations
            .filter((c) => c.type === 'SUPPORT')
            .reduce((total, c) => total + c.unreadCount, 0),
          useChatStore: {
            getState: () => chatState,
            subscribe: (listener) => chatListeners.push(listener),
          },
        };
      }
      throw new Error(`unexpected require: ${request}`);
    },
  });
  return {
    badge,
    chatState,
    applied,
    assistantApplied,
    emitChat: () => chatListeners.forEach((listener) => listener()),
    sums: () => sums,
  };
}

test('store writes that do not touch the conversation list reuse the last total', () => {
  const env = loadBadge();
  env.badge.initChatAppBadgeSync();
  const afterInstall = env.sums();

  // typing / presence / delivered:conversations 引用没变。
  env.emitChat();
  env.emitChat();
  env.emitChat();
  assert.equal(env.sums(), afterInstall);
  assert.deepEqual(env.applied, [2]);
});

test('a new conversation list recomputes the total', () => {
  const env = loadBadge();
  env.badge.initChatAppBadgeSync();

  env.chatState.conversations = [{ id: 'a', unreadCount: 5 }];
  env.emitChat();
  assert.deepEqual(env.applied, [2, 5]);
});

// AI 小助手不进消息 tab 和图标角标,它的未读单独交给探索 tab 和小助手卡片。
test('the assistant unread feeds the explore badge, never the messages tab', () => {
  const env = loadBadge();
  env.badge.initChatAppBadgeSync();

  env.chatState.conversations = [
    { id: 'a', unreadCount: 2 },
    { id: 'assistant-1', type: 'SUPPORT', unreadCount: 1 },
  ];
  env.emitChat();
  assert.deepEqual(env.applied, [2]);
  assert.deepEqual(env.assistantApplied, [0, 1]);
});
