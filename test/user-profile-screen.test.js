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
  const i18nStub = {
    default: {
      t: (key) => {
        const translations = {
          'profileFields.male': '男',
          'profileFields.female': '女',
          'profileFields.other': '其他',
          'profileFields.genderNotSet': '未设置',
          'profileFields.notSet': '未设置',
          'userProfile.friendAction.pendingSent': '已发送申请',
          'userProfile.friendAction.pendingReceived': '等待对方处理',
          'userProfile.friendAction.accepted': '已添加',
          'userProfile.friendAction.blocked': '无法添加',
          'userProfile.friendAction.add': '添加好友',
        };
        return translations[key] ?? key;
      },
    },
  };
  return loadTsModule('src/features/user/profile-view.ts', {
    '@/i18n': i18nStub,
  });
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

test('user profile screen renders unified display icons from backend data', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/user/screens/UserProfileScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /displayIcons/);
  assert.match(source, /UserIconRow/);
});

test('user profile route helpers preserve scope for the request form', () => {
  const {
    getChatInfoHref,
    getChatHistoryDateHref,
    getChatHistoryFilesHref,
    getChatHistoryMediaHref,
    getChatHistorySearchHubHref,
    getChatHistoryTextHref,
    getChatDetailHref,
    getEditFriendRemarkHref,
    getEditFriendTagsHref,
    getSendFriendRequestHref,
    getUserProfileScopeFromSegments,
  } = loadTsModule('src/features/user/utils/routes.ts');

  assert.deepEqual(
    JSON.parse(JSON.stringify(getChatInfoHref('contacts', 'user-1', '小李'))),
    {
      pathname: '/(tabs)/contacts/user/[id]/chat-info',
      params: { id: 'user-1', name: '小李', originScope: 'contacts' },
    },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(getChatInfoHref('profile', 'user-1', '阿梅'))),
    {
      pathname: '/(tabs)/profile/user/[id]/chat-info',
      params: { id: 'user-1', name: '阿梅', originScope: 'profile' },
    },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(getChatInfoHref('messages', 'user-1', '小李', 'conversation-1'))),
    {
      pathname: '/(tabs)/messages/chat-info',
      params: {
        id: 'user-1',
        name: '小李',
        conversationID: 'conversation-1',
        originScope: 'messages',
      },
    },
  );
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
    JSON.parse(JSON.stringify(getChatDetailHref('messages', 'user-1', '小李', 'https://img.example/avatar.png', 'conversation-1'))),
    {
      pathname: '/(tabs)/messages/chat-detail',
      params: {
        sourceID: 'user-1',
        title: '小李',
        conversationType: 'private',
        avatarUrl: 'https://img.example/avatar.png',
        conversationID: 'conversation-1',
      },
    },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(getChatHistorySearchHubHref('conversation-1', 'user-1', '小李'))),
    {
      pathname: '/(tabs)/messages/chat-history-search',
      params: {
        conversationID: 'conversation-1',
        sourceID: 'user-1',
        title: '小李',
      },
    },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(getChatHistoryTextHref('conversation-1', 'user-1', '小李'))),
    {
      pathname: '/(tabs)/messages/chat-history-text',
      params: {
        conversationID: 'conversation-1',
        sourceID: 'user-1',
        title: '小李',
      },
    },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(getChatHistoryMediaHref('conversation-1', 'user-1', '小李'))),
    {
      pathname: '/(tabs)/messages/chat-history-media',
      params: {
        conversationID: 'conversation-1',
        sourceID: 'user-1',
        title: '小李',
      },
    },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(getChatHistoryFilesHref('conversation-1', 'user-1', '小李'))),
    {
      pathname: '/(tabs)/messages/chat-history-files',
      params: {
        conversationID: 'conversation-1',
        sourceID: 'user-1',
        title: '小李',
      },
    },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(getChatHistoryDateHref('conversation-1', 'user-1', '小李'))),
    {
      pathname: '/(tabs)/messages/chat-history-date',
      params: {
        conversationID: 'conversation-1',
        sourceID: 'user-1',
        title: '小李',
      },
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

  assert.match(source, /const SELF_INFO_ROW_IDS = \['moments'\] as const;/);
  assert.match(source, /const NON_FRIEND_INFO_ROW_IDS = \['moments', 'giftCoins', 'moreInfo'\] as const;/);
  assert.match(source, /friendStatus === 'ACCEPTED'/);
  assert.match(source, /const showProfileActions = !isCurrentUser;/);
  assert.match(source, /t\('contacts\.accountId', \{ id: profile\.accountId \}\)/);
  assert.doesNotMatch(source, /圈号：/);
  assert.match(source, /const isCurrentUser = isCurrentUserProfile\(/);
  assert.match(source, /useRouter/);
  assert.match(source, /fetchFriendStatus/);
  assert.match(source, /fetchFriendSettings/);
  assert.match(source, /getOrCreateSingleConversation/);
  assert.match(source, /const \[friendStatus, setFriendStatus\]/);
  assert.match(source, /const \[friendSettings, setFriendSettings\]/);
  assert.match(source, /const showAddFriendButton = canSendFriendRequest/);
  assert.match(source, /const displayName = friendSettings\?\.remark\?\.trim\(\)/);
  assert.match(source, /const infoRowItems = useMemo/);
  assert.match(source, /ProfileActionRow/);
  assert.doesNotMatch(source, /actionSection:\s*{\s*borderTopWidth:/);
  assert.match(source, /actionButton:/);
  assert.match(source, /shadowOpacity:/);
  assert.match(source, /elevation:/);
  assert.match(source, /value: remarkValue/);
  assert.match(source, /value: tagValue/);
  assert.match(source, /location-outline/);
  assert.match(source, /badgeIconRow/);
  assert.match(source, /showProfileActions \? \(/);
  assert.match(source, /t\('userProfile\.addFriendRequest'\)/);
  assert.match(source, /const handleOpenChat = useCallback/);
  assert.match(source, /const conversation = await getOrCreateSingleConversation\(profileId\)/);
  assert.match(source, /shouldOpenChatPreview/);
  assert.match(source, /if \(shouldOpenChatPreview\(error\)\)/);
  assert.match(source, /router\.push\(\s*getChatDetailHref\(/);
  assert.match(source, /useSegments/);
  assert.match(source, /getChatDetailHref/);
  assert.match(source, /getSendFriendRequestHref/);
  assert.match(source, /getEditFriendRemarkHref/);
  assert.match(source, /getEditFriendTagsHref/);
  assert.match(source, /canOpenSendFriendRequest/);
  assert.doesNotMatch(source, /getFriendActionLabel/);
  assert.doesNotMatch(source, /setFriendStatus\('NONE'\)/);
});

test('user profile screen wires the top-right menu into chat info for accepted friends', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/user/screens/UserProfileScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /const canOpenChatInfo =[\s\S]*friendStatus === 'ACCEPTED'/);
  assert.match(source, /<NavHeader[\s\S]*title=\{t\('userProfile\.title'\)\}[\s\S]*rightIcon=\{canOpenChatInfo \? 'information-circle-outline' : undefined\}[\s\S]*onRightPress=\{canOpenChatInfo \? handleOpenChatInfo : undefined\}/);
  assert.match(source, /const handleOpenChatInfo = useCallback/);
  assert.match(source, /friendStatus !== 'ACCEPTED'/);
  assert.match(source, /getChatInfoHref/);
  assert.match(source, /router\.push\(getChatInfoHref\(scope, profileId, displayName\)\)/);
});

test('scope-specific chat info route files exist for contacts and profile stacks', () => {
  const contactsRoute = fs.readFileSync(
    path.join(process.cwd(), 'app/(tabs)/contacts/user/[id]/chat-info.tsx'),
    'utf8',
  );
  const profileRoute = fs.readFileSync(
    path.join(process.cwd(), 'app/(tabs)/profile/user/[id]/chat-info.tsx'),
    'utf8',
  );

  assert.match(contactsRoute, /ChatInfoScreen/);
  assert.match(profileRoute, /ChatInfoScreen/);
});
