const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 回到页面时只有「可能变了」才重拉:窗口内、没有相关写请求、失效键没变就跳过。
const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

test('friend tags only reload on focus after a friend change', () => {
  const src = read('src/features/contacts/screens/FriendTagsScreen.tsx');
  assert.match(src, /useFocusReloadGate\(\{\s*key: unreadFriendActivityCount,\s*mutatedSince: friendsMutatedSince,/);
  assert.match(src, /if \(tagsReloadGate\.shouldSkip\(\)\) return;/);
  assert.match(src, /tagsReloadGate\.markLoaded\(startedAt\)/);
});

test('note detail only reloads on focus after a note change and refreshes silently', () => {
  const src = read('src/features/notes/screens/NoteDetailScreen.tsx');
  assert.match(src, /mutatedSince: notesMutatedSince/);
  assert.match(src, /reloadGate\.shouldSkip\(\)/);
  assert.match(src, /reloadGate\.markLoaded\(startedAt\)/);
  // 已经有内容时后台刷新,不再整屏转圈。
  assert.doesNotMatch(src, /let cancelled = false;\n    setLoading\(true\);/);
});

test('system announcements skip both the page reload and mark-read when nothing changed', () => {
  const src = read('src/features/profile/screens/SystemAnnouncementsScreen.tsx');
  const skips = src.match(/announcementsReloadGate\.shouldSkip\(\)/g) ?? [];
  assert.equal(skips.length, 2, 'both focus effects consult the same gate');
  assert.match(src, /announcementsReloadGate\.markLoaded\(startedAt\)/);
});

test('the profile announcement banner does not refetch on every tab switch', () => {
  const src = read('src/features/profile/components/ScrollingAnnouncements.tsx');
  assert.match(src, /bannerReloadGate\.shouldSkip\(\)/);
  assert.match(src, /bannerReloadGate\.markLoaded\(startedAt\)/);
});

test('my circles reuse the store unless stale, and circle detail reloads only after a circle change', () => {
  const store = read('src/features/discover/store/use-circles-store.ts');
  assert.match(store, /circlesMutatedSince\(/);
  assert.match(store, /if \(!options\.force/);
  const detail = read('src/features/discover/screens/CircleDetailScreen.tsx');
  assert.match(detail, /mutatedSince: circlesMutatedSince/);
  assert.match(detail, /reloadGate\.shouldSkip\(\)/);
});

test('chat info reloads friend status and group data only when something may have changed', () => {
  const src = read('src/features/chat/screens/ChatInfoScreen.tsx');
  assert.match(src, /friendStatusReloadGate = useFocusReloadGate\(\{[\s\S]*?mutatedSince: friendsMutatedSince/);
  assert.match(src, /groupReloadGate = useFocusReloadGate\(\{[\s\S]*?mutatedSince: groupOrCircleMutatedSince/);
  assert.match(src, /friendStatusReloadGate\.shouldSkip\(\)/);
  assert.match(src, /groupReloadGate\.shouldSkip\(\)/);
  assert.match(src, /groupReloadGate\.markLoaded\(startedAt\)/);
});

test('group manage reloads only after a change and only spins on the first load', () => {
  const src = read('src/features/chat/screens/GroupManageScreen.tsx');
  assert.match(src, /mutatedSince: groupOrCircleMutatedSince/);
  assert.match(src, /reloadGate\.shouldSkip\(\)/);
  assert.match(src, /reloadGate\.markLoaded\(startedAt\)/);
  assert.doesNotMatch(src, /\n    setLoading\(true\);\n    setError\(false\);/, 'spinner must not show on every refocus');
  assert.match(src, /if \(!loadedRef\.current\) setLoading\(true\)/);
});

test('group admissions keep their rows on return and reload only after a change', () => {
  const src = read('src/features/groups/GroupAdmissionsList.tsx');
  // 列表里也有圈子邀请,接受/拒绝走圈子写请求:两路都要算。
  assert.match(src, /mutatedSince: groupOrCircleMutatedSince/);
  assert.match(src, /admissionsReloadGate\.shouldSkip\(\)/);
  assert.match(src, /admissionsReloadGate\.markLoaded\(startedAt\)/);
  const focus = src.slice(src.indexOf('useFocusEffect('), src.indexOf('const lastNotification'));
  assert.doesNotMatch(focus, /\n      setItems\(\[\]\);/, 'do not blank the list on every focus');
});
