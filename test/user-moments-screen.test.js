const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

test('UserMomentsScreen wires header + album list + pagination', () => {
  const src = read('src/features/discover/screens/UserMomentsScreen.tsx');
  assert.match(src, /useUserMoments/);
  assert.match(src, /MomentAlbumHeader/);
  assert.match(src, /MomentAlbumRow/);
  assert.match(src, /isSameCalendarDay/); // 同日分组决定 showDate
  assert.match(src, /FlatList/);
  assert.match(src, /onEndReached/);
  assert.match(src, /RefreshControl/);
  assert.match(src, /fetchUserProfile/); // 拉封面/头像
  assert.match(src, /getProfileSignature/); // 拉个性签名
  assert.match(src, /signature=\{signature\}/);
  assert.match(src, /moment\/\[id\]/); // 跳详情复用现有路由
  assert.match(src, /discover\.noMoments/); // 空态复用现有文案
});

test('UserMomentsScreen resolves non-UUID route ids before fetching author moments', () => {
  const src = read('src/features/discover/screens/UserMomentsScreen.tsx');
  const hook = read('src/features/discover/hooks/use-user-moments.ts');

  assert.match(src, /function isUuid/);
  assert.match(src, /canonicalUserId/);
  assert.match(src, /useUserMoments\(canonicalUserId\)/);
  assert.match(src, /setCanonicalUserId\(profile\.id\)/);
  assert.match(src, /profileError/);
  assert.match(src, /profileResolving/);
  assert.match(src, /setCover\(null\)/);
  assert.match(src, /setAvatarUrl\(null\)/);
  assert.match(src, /setSignature\(''\)/);
  assert.match(src, /setProfileError\(getApiErrorMessage\(err/);
  assert.match(src, /!loading && !profileResolving/);
  assert.match(src, /profileError \?\? error \?\? t\('discover\.noMoments'\)/);
  assert.match(hook, /if \(!userId\) \{/);
  assert.match(hook, /setMoments\(\[\]\)/);
  assert.match(hook, /setHasMore\(false\)/);
  assert.match(hook, /setLoading\(false\)/);
  assert.doesNotMatch(src, /useUserMoments\(userId\)/);
});

test('moment album i18n keys exist in both locales', () => {
  const zh = JSON.parse(read('src/i18n/locales/zh.json'));
  const en = JSON.parse(read('src/i18n/locales/en.json'));
  assert.ok(zh.moment.albumTitle);
  assert.ok(en.moment.albumTitle);
});
