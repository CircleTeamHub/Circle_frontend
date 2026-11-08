const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function listSources(dir) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSources(rel));
    else if (/\.tsx$/.test(entry.name) && !/\.(spec|test)\.tsx$/.test(entry.name)) out.push(rel);
  }
  return out;
}

function refreshingBindings() {
  const out = [];
  for (const rel of listSources('src')) {
    const file = rel.split(path.sep).join('/');
    read(rel).split('\n').forEach((line, index) => {
      for (const match of line.matchAll(/\brefreshing=\{([^}]*)\}/g)) {
        out.push({ file, line: index + 1, expr: match[1].trim() });
      }
    });
  }
  return out;
}

// iOS 的 UIRefreshControl 被程序置成刷新态时,会把整张列表往下推一截转圈、加载完再弹回去,
// 用户看到的就是「列表从下往上弹」。所以下拉刷新控件只能跟下拉走,不能绑页面的 loading。
test('no list binds its pull-to-refresh control to a loading state', () => {
  const offenders = refreshingBindings()
    .filter(({ expr }) => /(^|[^A-Za-z])loading\b/.test(expr))
    .map(({ file, line, expr }) => `${file}:${line}: refreshing={${expr}}`);
  assert.deepEqual(offenders, [], `下拉刷新控件绑了 loading:\n${offenders.join('\n')}`);
});

// 这些页面都踩过「自动加载驱动下拉刷新控件」:进页面 / 回到页面 / 操作后重拉时把 refreshing 置 true。
const PULL_ONLY_SCREENS = [
  'src/features/notifications/screens/NotificationCenterScreen.tsx',
  'src/features/notifications/screens/PostSignupsScreen.tsx',
  'src/features/profile/screens/SystemAnnouncementsScreen.tsx',
  'src/features/profile/screens/CollectionsScreen.tsx',
  'src/features/groups/GroupAdmissionsList.tsx',
  'src/features/groups/GroupReviewScreen.tsx',
  'src/features/chat/screens/GroupAbnormalMembersScreen.tsx',
  'src/features/discover/screens/UserMomentsScreen.tsx',
];

test('screens whose automatic loads used to drive the refresh control now use usePullRefresh', () => {
  for (const file of PULL_ONLY_SCREENS) {
    const source = read(file);
    assert.match(source, /const pull = usePullRefresh\(/, `${file} 应该用 usePullRefresh`);
    assert.match(source, /refreshing=\{pull\.refreshing\}/, `${file} 的下拉刷新控件应该绑 pull.refreshing`);
    assert.match(source, /onRefresh=\{[^}]*pull\.onRefresh\}/, `${file} 的 onRefresh 应该走 pull.onRefresh`);
  }
});
