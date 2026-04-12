const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('add friend screen is a minimal account-id search flow', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/social/screens/AddFriendScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /searchUsersByAccountId/);
  assert.match(source, /未找到好友/);
  assert.match(source, /输入对方账号/);
  assert.match(source, /账号：\{result\.accountId\}/);
  assert.match(source, /handleSearch/);
  assert.match(source, /getUserProfileHref/);
  assert.doesNotMatch(source, /查看详情并添加好友/);
  assert.doesNotMatch(source, /搜索账号/);
  assert.doesNotMatch(source, /placeholder="输入对方 accountId"/);
  assert.doesNotMatch(source, /圈号：\{result\.accountId\}/);
  assert.doesNotMatch(source, /支持按完整 accountId/);
  assert.doesNotMatch(source, /输入 accountId 后开始搜索/);
  assert.doesNotMatch(source, /支持按完整/);
  assert.doesNotMatch(source, /输入 .* 后开始搜索/);
  assert.doesNotMatch(source, /雷达加友/);
  assert.doesNotMatch(source, /扫一扫/);
});
