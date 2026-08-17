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
  // After S13 i18n migration: account label is rendered via
  // t('contacts.accountId', { id: result.accountId }) — locale JSON owns the "账号：{{id}}" format.
  assert.match(source, /contacts\.accountId/);
  assert.match(source, /id: result\.accountId/);
  assert.match(source, /handleSearch/);
  assert.match(source, /getUserProfileHref/);
  // 打开搜到的用户 profile 必须按本屏所在 tab 栈推断 scope(messages/contacts 都有
  // re-export),不能写死 'contacts' —— 否则从聊天页搜索进来会把 profile 推进 contacts
  // 栈,导致退出串栈、通讯录 tab 卡在 profile。
  assert.match(source, /getUserProfileScopeFromSegments/);
  assert.doesNotMatch(source, /getUserProfileHref\(\s*['"]contacts['"]/);
  assert.doesNotMatch(source, /查看详情并添加好友/);
  assert.doesNotMatch(source, /搜索账号/);
  assert.doesNotMatch(source, /placeholder="输入对方 accountId"/);
  assert.doesNotMatch(source, /圈号：\{result\.accountId\}/);
  assert.doesNotMatch(source, /支持按完整 accountId/);
  assert.doesNotMatch(source, /输入 accountId 后开始搜索/);
  assert.doesNotMatch(source, /支持按完整/);
  assert.doesNotMatch(source, /输入 .* 后开始搜索/);
  assert.doesNotMatch(source, /雷达加友/);
  // 「扫一扫」曾是死入口被清理;二维码功能落地后它是活路由,现在必须存在:
  // 出示名片码 + 扫码双入口(微信「添加朋友」页同款),由 qr-feature.test.js 细验。
  assert.match(source, /qr\.myQrEntry/);
  assert.match(source, /messages\.scan/);
});
