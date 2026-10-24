const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

// 通讯录回到前台时据此判断能不能跳过重拉:好友相关的写请求成功后都要记一笔,
// 读请求不算。好友多的用户进出聊天页、资料页,原来每次都整表重拉好友。
function loadFriendsApi() {
  const friends = loadTsModule('src/services/api/friends.ts', {
    requireShim: (request) => {
      if (request === '@/services/api/client') {
        return { apiClient: async () => [] };
      }
      if (request === '@/types') return {};
      if (request === '@/services/api/utils') {
        // 接口返回空数组,规范化函数用不到;只给 friends.ts 引用的三个名字。
        return {
          fetchCountEndpoint: async () => 0,
          normalizeAvatarFrameAppearance: (value) => value ?? null,
          normalizeMediaUrl: (value) => value,
        };
      }
      return require(request);
    },
  });
  return friends;
}

test('friend writes mark the friend list stale; reads do not', async () => {
  const friends = loadFriendsApi();
  const before = Date.now();
  await friends.fetchFriends();
  assert.equal(friends.friendsMutatedSince(before), false);

  await friends.setFriendRemark('u2', '老王');
  assert.equal(friends.friendsMutatedSince(before), true);
});

test('every friend write goes through the marker with a static apiClient path', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src/services/api/friends.ts'),
    'utf8',
  );
  const writes = source.match(/method: '(POST|PATCH|PUT|DELETE)'/g) ?? [];
  const marked = source.match(/markFriendWrite\(apiClient/g) ?? [];
  assert.ok(writes.length > 0);
  assert.equal(marked.length, writes.length, 'wrap every friend write in markFriendWrite');
});

test('contacts and note list screens only reload on focus when something may have changed', () => {
  const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  const contacts = read('src/features/contacts/screens/ContactsScreen.tsx');
  assert.match(contacts, /useFocusReloadGate\(\{\s*key: unreadFriendActivityCount,\s*mutatedSince: friendsMutatedSince,/);
  assert.match(contacts, /if \(!friendsReloadGate\.shouldSkip\(\)\) void loadFriends\(\);/);

  const unlisted = read('src/features/notes/screens/UnlistedNotesScreen.tsx');
  assert.match(unlisted, /mutatedSince: notesMutatedSince/);
  assert.match(unlisted, /if \(reloadGate\.shouldSkip\(\)\) return;/);

  const management = read('src/features/notes/screens/NoteManagementScreen.tsx');
  assert.match(management, /mutatedSince: notesMutatedSince/);
  assert.match(management, /if \(!notesReloadGate\.shouldSkip\(\)\) void loadNotes\(\);/);
  // 群笔记管理与群管理只需要这一个群的 DTO,不再为它重拉整张会话列表。
  assert.match(management, /refreshConversationOrList\(conversationID\)/);
  const groupManage = read('src/features/chat/screens/GroupManageScreen.tsx');
  assert.doesNotMatch(groupManage, /loadChatConversations\(/);
});
