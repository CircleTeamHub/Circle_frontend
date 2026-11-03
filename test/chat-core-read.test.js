const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

function loadClient() {
  const reads = [];
  const state = {
    messagesByConversation: { conversation: [{ height: 3 }, { height: 9 }] },
    conversations: [{ id: 'empty', lastMessage: { height: 12 } }],
  };
  const client = loadTsModule('src/chat-core/client.ts', {
    requireShim: (request) => {
      if (request === './store') return { useChatStore: { getState: () => state } };
      if (request === './socket-manager') return { markConversationRead: (...args) => reads.push(args) };
      if (request === './sync') return { setConversationCacheResetHandler: () => {} };
      return {};
    },
  });
  return { client, reads };
}

test('an explicit gallery read height does not mark newer loaded messages read', () => {
  const { client, reads } = loadClient();
  client.markConversationAsRead('conversation', 3);
  assert.deepEqual(reads, [['conversation', 3]]);
});

test('normal conversation reads retain latest-message and preview fallback behavior', () => {
  const { client, reads } = loadClient();
  client.markConversationAsRead('conversation');
  client.markConversationAsRead('empty');
  assert.deepEqual(reads, [['conversation', 9], ['empty', 12]]);
});

test('invalid explicit read heights do not fall back to the latest message', () => {
  const { client, reads } = loadClient();
  for (const height of [0, -1, NaN, Infinity, 1.5]) client.markConversationAsRead('conversation', height);
  assert.deepEqual(reads, []);
});
