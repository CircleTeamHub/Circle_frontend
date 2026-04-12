const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

test('contacts screen loads real friends and routes quick actions to dedicated screens', () => {
  const source = read('src/features/contacts/screens/ContactsScreen.tsx');

  assert.match(source, /fetchFriends/);
  assert.match(source, /useFocusEffect/);
  assert.match(source, /buildContactSections/);
  assert.match(source, /router\.push\('\/\(tabs\)\/contacts\/new-friends'\)/);
  assert.match(source, /router\.push\('\/\(tabs\)\/contacts\/tags'\)/);
  assert.doesNotMatch(source, /const CONTACT_SECTIONS/);
  assert.doesNotMatch(source, /useEffect\(/);
});

test('new friends screen exists as a friend-activity inbox with per-item read flow', () => {
  const routeSource = read('app/(tabs)/contacts/new-friends.tsx');
  const screenSource = read('src/features/contacts/screens/NewFriendsScreen.tsx');

  assert.match(routeSource, /NewFriendsScreen/);
  assert.match(screenSource, /fetchFriendActivities/);
  assert.match(screenSource, /buildFriendActivityInboxRows/);
  assert.match(screenSource, /markFriendActivityRead/);
  assert.match(screenSource, /useFriendActivityUnreadStore/);
  assert.match(screenSource, /markRead/);
  assert.match(screenSource, /useFocusEffect/);
  assert.match(screenSource, /getFriendActivityCopy/);
  assert.match(screenSource, /Promise\.all/);
  assert.match(screenSource, /getFriendActivityDetailHref\(item\.activity\.id\)/);
  assert.doesNotMatch(screenSource, /ListHeaderComponent/);
  assert.doesNotMatch(
    screenSource,
    /这里展示好友申请、通过、拒绝和撤回等动态，点击单条后进入详情并标记已读。/,
  );
});

test('contacts unread indicators use the shared unread store', () => {
  const tabsLayoutSource = read('app/(tabs)/_layout.tsx');
  const contactsSource = read('src/features/contacts/screens/ContactsScreen.tsx');
  const menuRowSource = read('src/components/ui/menu-row.tsx');

  assert.match(tabsLayoutSource, /useFriendActivityUnreadStore/);
  assert.match(contactsSource, /useFriendActivityUnreadStore/);
  assert.match(contactsSource, /showIndicatorDot/);
  assert.match(menuRowSource, /showIndicatorDot/);
  assert.doesNotMatch(contactsSource, /fetchUnreadFriendActivityCount/);
  assert.doesNotMatch(
    tabsLayoutSource,
    /const \[unreadFriendActivityCount, setUnreadFriendActivityCount\]/,
  );
});

test('tags screens load tag data and tagged friends with dedicated routes', () => {
  const tagsRouteSource = read('app/(tabs)/contacts/tags.tsx');
  const tagDetailRouteSource = read('app/(tabs)/contacts/tags/[id].tsx');
  const tagsScreenSource = read('src/features/contacts/screens/FriendTagsScreen.tsx');
  const tagDetailScreenSource = read('src/features/contacts/screens/FriendTagDetailScreen.tsx');

  assert.match(tagsRouteSource, /FriendTagsScreen/);
  assert.match(tagDetailRouteSource, /FriendTagDetailScreen/);
  assert.match(tagsScreenSource, /fetchFriendTags/);
  assert.match(tagsScreenSource, /fetchFriendsByTag/);
  assert.match(tagDetailScreenSource, /fetchFriendsByTag/);
  assert.match(tagDetailScreenSource, /buildContactSections/);
});

test('friend activity detail screen supports request handling and single-item read state', () => {
  const routeSource = read('app/(tabs)/contacts/new-friends/[id].tsx');
  const screenSource = read('src/features/contacts/screens/FriendActivityDetailScreen.tsx');

  assert.match(routeSource, /FriendActivityDetailScreen/);
  assert.match(screenSource, /fetchFriendActivityDetail/);
  assert.match(screenSource, /acceptFriendRequest/);
  assert.match(screenSource, /rejectFriendRequest/);
  assert.match(screenSource, /canHandleFriendActivity/);
  assert.match(screenSource, /REQUEST_RECEIVED/);
});
