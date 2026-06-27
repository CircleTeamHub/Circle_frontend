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

test('moment album i18n keys exist in both locales', () => {
  const zh = JSON.parse(read('src/i18n/locales/zh.json'));
  const en = JSON.parse(read('src/i18n/locales/en.json'));
  assert.ok(zh.moment.albumTitle);
  assert.ok(en.moment.albumTitle);
});
