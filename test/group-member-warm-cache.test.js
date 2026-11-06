const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

test('chat member prefetch warms info entry for each group kind and ignores old sessions', async () => {
  let epoch = 101;
  let complete;
  const authStore = { useAuthStore: { getState: () => ({ sessionEpoch: epoch }) } };
  // 缓存自己按 authStore 的 sessionEpoch 判断账号有没有变。
  const cache = loadTsModule('src/features/chat/group-info-cache.ts', { requireShim: (request) => {
    if (request === '@/stores/authStore') return authStore;
    if (request === '@/features/chat/utils/group-reload-key') return { groupOrCircleMutatedSince: () => false };
    return require(request);
  } });
  const conversations = [
    { id: 'standalone', type: 'GROUP', circleId: null },
    { id: 'circle-chat', type: 'GROUP', circleId: 'circle' },
    { id: 'room', type: 'TEMP' },
  ];
  const api = loadTsModule('src/chat-core/api.ts', { requireShim: (request) => {
    if (request === '@/services/api/client') return { apiClient: () => new Promise(resolve => { complete = resolve; }) };
    if (request === '@/stores/authStore') return authStore;
    if (request === './store') return { useChatStore: { getState: () => ({ conversations }) } };
    if (request === '@/features/chat/group-info-cache') return cache;
    return {};
  } });
  const members = [{ userId: 'me', nickname: 'Member' }];
  for (const [id, key] of [['standalone', 'standalone:standalone'], ['circle-chat', 'circle:circle'], ['room', 'temp:room']]) {
    const pending = api.fetchChatMembers(id);
    complete(members);
    await pending;
    assert.equal(cache.readGroupInfoCache(epoch, key).members, members);
  }
  const stale = api.fetchChatMembers('standalone');
  epoch += 1;
  complete(members);
  await stale;
  assert.equal(cache.readGroupInfoCache(epoch, 'standalone:standalone'), undefined);
});
