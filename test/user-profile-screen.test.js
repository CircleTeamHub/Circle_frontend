const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadProfileView() {
  const filePath = path.join(
    process.cwd(),
    'src/features/user/profile-view.ts',
  );
  const source = fs.readFileSync(filePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;

  const context = {
    module: { exports: {} },
    exports: {},
    require,
  };
  context.exports = context.module.exports;

  vm.runInNewContext(transpiled, context, { filename: filePath });

  return context.module.exports;
}

test('profile view formats self check, gender, and city for the detail header', () => {
  const {
    formatGenderLabel,
    getProfileMetaItems,
    isCurrentUserProfile,
  } = loadProfileView();

  assert.equal(formatGenderLabel('male'), '男');
  assert.equal(formatGenderLabel('female'), '女');
  assert.equal(formatGenderLabel('unset'), '未设置');

  assert.deepEqual(
    Array.from(getProfileMetaItems({ gender: 'female', city: '杭州' })),
    ['女', '杭州'],
  );
  assert.deepEqual(
    Array.from(getProfileMetaItems({ gender: null, city: ' ' })),
    ['未设置', '未设置'],
  );

  assert.equal(
    isCurrentUserProfile('me', { id: 'user-1', accountId: 'jimmy' }),
    true,
  );
  assert.equal(
    isCurrentUserProfile('user-1', { id: 'user-1', accountId: 'jimmy' }),
    true,
  );
  assert.equal(
    isCurrentUserProfile('jimmy', { id: 'user-1', accountId: 'jimmy' }),
    true,
  );
  assert.equal(
    isCurrentUserProfile('other-user', { id: 'user-1', accountId: 'jimmy' }),
    false,
  );
});

test('user profile screen uses account label, meta chips, badge row, and conditional add friend button', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/user/screens/UserProfileScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /账号：\{profile\.accountId\}/);
  assert.doesNotMatch(source, /圈号：/);
  assert.match(source, /const isCurrentUser = isCurrentUserProfile\(/);
  assert.match(source, /const showAddFriendButton = !isCurrentUser;/);
  assert.match(source, /profileMetaItems\.map/);
  assert.match(source, /location-outline/);
  assert.match(source, /badgeIconRow/);
});
