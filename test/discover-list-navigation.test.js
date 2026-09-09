const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

const PLAZA = 'src/features/discover/screens/CirclePlazaScreen.tsx';
const exists = (rel) => fs.existsSync(path.join(process.cwd(), rel));

test('动态 tab 的根屏直接就是圈子广场，中间那层入口列表已删除', () => {
  assert.match(read('app/(tabs)/discover/index.tsx'), /CirclePlazaScreen/);

  // 原来的 DiscoverScreen 整屏只有一行「圈子广场」菜单，进去才是内容 ——
  // 一跳的纯中转层。屏和它那条独立路由一起删掉，别留下第二个入口。
  assert.equal(exists('src/features/discover/screens/DiscoverScreen.tsx'), false);
  assert.equal(exists('app/(tabs)/discover/plaza.tsx'), false);
});

test('动态根屏不夹带朋友圈 / 圈子管理（原 discover home 的约束跟着搬到广场上）', () => {
  const source = read(PLAZA);

  assert.doesNotMatch(source, /\/\(tabs\)\/discover\/moments/);
  assert.doesNotMatch(source, /\/\(tabs\)\/discover\/management/);
  assert.doesNotMatch(source, /<FilterTabs/);
  assert.doesNotMatch(source, /<MomentsFeed/);
  assert.doesNotMatch(source, /<MyCirclesPanel/);
});

test('作为 tab 根屏，广场头部不能再渲染返回箭头', () => {
  const source = read(PLAZA);

  // NavHeader 无条件渲染 chevron-back —— 用在 tab 根屏上会留一个
  // 按了没反应的返回键（canGoBack 假、fallbackHref 又指回自己）。
  assert.doesNotMatch(source, /<NavHeader/);
  assert.doesNotMatch(source, /name="chevron-back"/);
  assert.doesNotMatch(source, /fallbackHref/);

  // 改用本仓库 tab 根屏的既有写法（对齐 ContactsScreen）：大标题 + 右侧动作，
  // 标题跟 tab 标签一致。
  assert.match(source, /Typography\.title/);
  assert.match(source, /t\('discover\.title'\)/);
});

test('广场顶部保留未读口径：圈子通知 + 报名，不掺朋友圈', () => {
  const source = read(PLAZA);

  assert.match(source, /useTabBadgeStore\(\(state\) => state\.circleUnread\)/);
  assert.match(source, /useTabBadgeStore\(\(state\) => state\.signupUnread\)/);
  assert.doesNotMatch(source, /state\.discoverUnread/);
  assert.doesNotMatch(source, /state\.momentsUnread/);
});

test('dedicated discover routes re-export their screens', () => {
  assert.match(
    read('app/(tabs)/discover/moments.tsx'),
    /MomentsScreen/,
  );
  assert.match(
    read('app/(tabs)/discover/management.tsx'),
    /CircleManagementScreen/,
  );
});

test('moments screen reuses the feed and keeps its create action', () => {
  const source = read('src/features/discover/screens/MomentsScreen.tsx');

  assert.match(source, /<MomentsFeed \/>/);
  assert.match(source, /\/\(tabs\)\/discover\/create-moment/);
  assert.match(source, /name="add"/);
});

test('circle plaza screen owns filter and create actions', () => {
  const source = read('src/features/discover/screens/CirclePlazaScreen.tsx');

  assert.match(source, /<PlazaFeed \/>/);
  assert.match(source, /\/\(tabs\)\/discover\/filter/);
  assert.match(source, /\/\(tabs\)\/discover\/create-post/);
  assert.match(source, /name="options-outline"/);
});

test('广场头部不再有搜索按钮（发现圈子入口已按要求移除）', () => {
  const source = read('src/features/discover/screens/CirclePlazaScreen.tsx');

  assert.doesNotMatch(source, /name="search-outline"/);
  assert.doesNotMatch(source, /\/\(tabs\)\/discover\/circles/);
  assert.doesNotMatch(source, /handleDiscoverCircles/);
  // testID 随按钮一起退场，别在目录里留下挂不上的死 locator。
  assert.doesNotMatch(source, /circlePlazaDiscoverCircles/);
  assert.doesNotMatch(
    read('src/testing/e2e-test-ids.ts'),
    /circlePlazaDiscoverCircles/,
  );
  assert.doesNotMatch(
    read('.maestro/flows/social-circle.yaml'),
    /circle-plaza\.discover-circles/,
  );
});

test('circle plaza owns the circle notification bell and opens the circle domain', () => {
  const source = read('src/features/discover/screens/CirclePlazaScreen.tsx');

  assert.match(source, /useTabBadgeStore\(\(state\) => state\.signupUnread\)/);
  assert.match(source, /name="notifications-outline"/);
  assert.match(source, /<Badge count=\{circleBellUnread\} \/>/);
  assert.match(source, /pathname: '\/\(tabs\)\/discover\/notification-center'/);
  assert.match(source, /params: \{ domain: 'circle' \}/);
});

test('moments bell opens the moments domain of the notification center', () => {
  const source = read('src/features/discover/screens/MomentsScreen.tsx');

  assert.match(source, /pathname: '\/\(tabs\)\/discover\/notification-center'/);
  assert.match(source, /params: \{ domain: 'moments' \}/);
});

test('notification center scopes its list to the requested bell domain', () => {
  const source = read(
    'src/features/notifications/screens/NotificationCenterScreen.tsx',
  );

  assert.match(source, /useLocalSearchParams/);
  assert.match(source, /parseNotificationDomain\(domainParam\)/);
  // 列表、拉取、全部已读三处都必须带域，少一处就会串台。
  assert.match(source, /notificationDomain\(n\.type\) === domain/);
  assert.match(source, /fetchNotifications\(1, domain\)/);
  assert.match(source, /markAllNotificationsRead\(domain\)/);
  // 报名管理是圈子域独有的 tab，朋友圈铃铛不显示也不为它请求数据。
  assert.match(source, /domain !== 'moments'/);
});

test('tab badges follow the moved moments and plaza ownership', () => {
  const source = read('app/(tabs)/_layout.tsx');

  assert.match(source, /signupUnread: state\.signupUnread/);
  // 只统计动态 tab 自己辖下的三样。曾经读 discoverUnread（= 好友申请 +
  // 朋友圈 + 圈子 的并集，互动消息列表页的全集口径），一条未读好友申请
  // 就会把动态 tab 也点亮 —— 好友申请的规范 UI 是「新的朋友」，归联系人。
  assert.match(
    source,
    /contacts: contactsUnread > 0 \|\| momentsUnread > 0/,
  );
  assert.match(source, /discover: circleUnread > 0 \|\| signupUnread > 0/);
  assert.doesNotMatch(source, /discover: discoverUnread/);
});

test('circle management screen reuses the panel and owns notification settings', () => {
  const source = read('src/features/discover/screens/CircleManagementScreen.tsx');

  assert.match(source, /<MyCirclesPanel \/>/);
  assert.match(source, /\/\(tabs\)\/discover\/notifications/);
  assert.match(source, /rightIcon="settings-outline"/);
});
