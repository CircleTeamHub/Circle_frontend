const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadTsModule(relativePath, stubs = {}) {
  const filePath = path.join(process.cwd(), relativePath);
  const source = fs.readFileSync(filePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      baseUrl: process.cwd(),
      paths: {
        '@/*': ['src/*'],
      },
    },
    fileName: filePath,
  }).outputText;

  const context = {
    module: { exports: {} },
    exports: {},
    require: (specifier) => {
      if (specifier in stubs) {
        return stubs[specifier];
      }

      return require(specifier);
    },
  };
  context.exports = context.module.exports;

  vm.runInNewContext(transpiled, context, { filename: filePath });

  return context.module.exports;
}

function loadProfileView() {
  return loadTsModule('src/features/user/profile-view.ts');
}

test('profile view formats self check, gender, and city for the detail header', () => {
  const {
    canOpenSendFriendRequest,
    getFriendActionLabel,
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

  assert.equal(getFriendActionLabel('NONE'), '添加好友');
  assert.equal(getFriendActionLabel('PENDING_SENT'), '已发送申请');
  assert.equal(getFriendActionLabel('PENDING_RECEIVED'), '等待对方处理');
  assert.equal(getFriendActionLabel('ACCEPTED'), '已添加');
  assert.equal(getFriendActionLabel('BLOCKED'), '无法添加');

  assert.equal(
    canOpenSendFriendRequest({
      isCurrentUser: false,
      profileId: 'other-user',
      friendStatus: 'NONE',
      hasProfileLoadError: false,
      hasFriendStatusLoadError: false,
    }),
    true,
  );
  assert.equal(
    canOpenSendFriendRequest({
      isCurrentUser: false,
      profileId: 'other-user',
      friendStatus: 'NONE',
      hasProfileLoadError: true,
      hasFriendStatusLoadError: false,
    }),
    false,
  );
  assert.equal(
    canOpenSendFriendRequest({
      isCurrentUser: false,
      profileId: 'other-user',
      friendStatus: 'NONE',
      hasProfileLoadError: false,
      hasFriendStatusLoadError: true,
    }),
    false,
  );
  assert.equal(
    canOpenSendFriendRequest({
      isCurrentUser: false,
      profileId: 'other-user',
      friendStatus: 'ACCEPTED',
      hasProfileLoadError: false,
      hasFriendStatusLoadError: false,
    }),
    false,
  );
  assert.equal(
    canOpenSendFriendRequest({
      isCurrentUser: true,
      profileId: 'me',
      friendStatus: 'NONE',
      hasProfileLoadError: false,
      hasFriendStatusLoadError: false,
    }),
    false,
  );
});

test('user profile route helpers preserve scope for the request form', () => {
  const {
    getEditFriendRemarkHref,
    getEditFriendTagsHref,
    getSendFriendRequestHref,
    getUserProfileScopeFromSegments,
  } = loadTsModule('src/features/user/utils/routes.ts');

  assert.deepEqual(
    JSON.parse(JSON.stringify(getSendFriendRequestHref('messages', 'user-1', '小李'))),
    {
      pathname: '/(tabs)/messages/user/[id]/request',
      params: { id: 'user-1', name: '小李' },
    },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(getSendFriendRequestHref('contacts', 'user-1'))),
    {
      pathname: '/(tabs)/contacts/user/[id]/request',
      params: { id: 'user-1' },
    },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(getSendFriendRequestHref('profile', 'user-1', '阿梅'))),
    {
      pathname: '/(tabs)/profile/user/[id]/request',
      params: { id: 'user-1', name: '阿梅' },
    },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(getEditFriendRemarkHref('contacts', 'user-1', '小李'))),
    {
      pathname: '/(tabs)/contacts/user/[id]/remark',
      params: { id: 'user-1', name: '小李' },
    },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(getEditFriendTagsHref('messages', 'user-1'))),
    {
      pathname: '/(tabs)/messages/user/[id]/tags',
      params: { id: 'user-1' },
    },
  );

  assert.equal(
    getUserProfileScopeFromSegments(['(tabs)', 'messages', 'user', '[id]']),
    'messages',
  );
  assert.equal(
    getUserProfileScopeFromSegments(['(tabs)', 'contacts', 'user', '[id]']),
    'contacts',
  );
  assert.equal(
    getUserProfileScopeFromSegments(['(tabs)', 'profile', 'user', '[id]']),
    'profile',
  );
});

test('user profile screen uses account label, meta chips, badge row, and conditional add friend button', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/user/screens/UserProfileScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /const SELF_INFO_ROWS = \['朋友圈'\] as const;/);
  assert.match(source, /const NON_FRIEND_INFO_ROWS = \['朋友圈', '给该用户赠送金币', '更多信息'\] as const;/);
  assert.match(source, /friendStatus === 'ACCEPTED'/);
  assert.match(source, /const showProfileActions = !isCurrentUser;/);
  assert.match(source, /账号：\{profile\.accountId\}/);
  assert.doesNotMatch(source, /圈号：/);
  assert.match(source, /const isCurrentUser = isCurrentUserProfile\(/);
  assert.match(source, /useRouter/);
  assert.match(source, /fetchFriendStatus/);
  assert.match(source, /fetchFriendSettings/);
  assert.match(source, /const \[friendStatus, setFriendStatus\]/);
  assert.match(source, /const \[friendSettings, setFriendSettings\]/);
  assert.match(source, /const showAddFriendButton = canSendFriendRequest/);
  assert.match(source, /const displayName = friendSettings\?\.remark\?\.trim\(\)/);
  assert.match(source, /const infoRowItems = useMemo/);
  assert.match(source, /ProfileActionRow/);
  assert.match(source, /value: remarkValue/);
  assert.match(source, /value: tagValue/);
  assert.match(source, /location-outline/);
  assert.match(source, /badgeIconRow/);
  assert.match(source, /showProfileActions \? \(/);
  assert.match(source, /发好友申请/);
  assert.match(source, /useSegments/);
  assert.match(source, /getSendFriendRequestHref/);
  assert.match(source, /getEditFriendRemarkHref/);
  assert.match(source, /getEditFriendTagsHref/);
  assert.match(source, /canOpenSendFriendRequest/);
  assert.doesNotMatch(source, /getFriendActionLabel/);
  assert.doesNotMatch(source, /setFriendStatus\('NONE'\)/);
});
