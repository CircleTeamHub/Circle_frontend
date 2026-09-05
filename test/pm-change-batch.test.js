const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relativePath) =>
  fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

test('registration enters the app without requiring the optional profile step', () => {
  const source = read('src/hooks/use-auth.ts');

  assert.match(
    source,
    /await onAuthSuccess\(tokens,\s*\{[\s\S]*onboardingRequired:\s*false/,
  );
  assert.doesNotMatch(
    source,
    /onboardingRequired:\s*true,\s*startAppServices:\s*false/,
  );
});

test('contacts owns moments and circle management while discover only owns plaza', () => {
  const contacts = read('src/features/contacts/screens/ContactsScreen.tsx');
  const discover = read('src/features/discover/screens/DiscoverScreen.tsx');
  const momentsRoute = read('app/(tabs)/contacts/moments.tsx');

  assert.match(contacts, /id: 'moments'/);
  assert.match(contacts, /key: 'discover\.moments'/);
  assert.match(contacts, /id: 'circles'[\s\S]*key: 'discover\.management'/);
  assert.match(contacts, /\/(?:\(tabs\)\/)?contacts\/moments/);
  assert.match(momentsRoute, /MomentsScreen/);
  assert.match(discover, /\/\(tabs\)\/discover\/plaza/);
  assert.doesNotMatch(discover, /\/\(tabs\)\/discover\/moments/);
  assert.doesNotMatch(discover, /\/\(tabs\)\/discover\/management/);
});

test('groups screen exposes new, joined, created, and managed categories', () => {
  const source = read('src/features/contacts/screens/GroupsScreen.tsx');

  assert.match(source, /fetchMyCircles\('applied'\)/);
  assert.match(source, /fetchMyCircles\('joined'\)/);
  assert.match(source, /fetchMyCircles\('created'\)/);
  assert.match(source, /myRole === 'OWNER' \|\| circle\.myRole === 'ADMIN'/);
  for (const key of ['newGroups', 'myJoined', 'myCreated', 'myManaged']) {
    assert.match(source, new RegExp(`contacts\\.groupsScreen\\.${key}`));
  }
  assert.match(source, /createGroupsRequestGuard/);
  assert.match(source, /state\.sessionEpoch/);
});

test('chat input remains keyboard-safe and pinned rows use one surface color', () => {
  const chat = read('src/features/chat/screens/ChatDetailScreen.tsx');
  const messages = read('src/features/messages/screens/MessagesScreen.tsx');

  assert.match(chat, /<KeyboardAvoidingView/);
  assert.match(chat, /keyboardVisible/);
  assert.match(messages, /pinnedSurface:\s*\{\s*backgroundColor:\s*colors\.surface/);
  assert.doesNotMatch(
    messages,
    /pinnedSurface:\s*\{[\s\S]{0,100}colors\.surfaceBorder/,
  );
});

test('group chat offers local and two-sided deletion plus management log access', () => {
  const info = read('src/features/chat/screens/ChatInfoScreen.tsx');
  const messages = read('src/features/messages/screens/MessagesScreen.tsx');
  const logScreen = read('src/features/chat/screens/GroupLogScreen.tsx');
  const logRoute = read('app/(tabs)/messages/group-log.tsx');
  const api = read('src/chat-core/api.ts');

  assert.match(info, /clearHistoryForMe/);
  assert.match(info, /clearHistoryForEveryone/);
  assert.match(info, /forEveryone/);
  assert.match(api, /pendingHistoryClears/);
  assert.match(api, /targetHeight/);
  assert.match(api, /getKnownClearTargetHeight\([\s\S]*?\)\s*\?\?\s*0/);
  assert.match(api, /targetHeight:\s*operation\.targetHeight/);
  assert.match(info, /groupLog/);
  assert.match(messages, /deleteForEveryone/);
  assert.match(logScreen, /system/);
  assert.match(logRoute, /GroupLogScreen/);
});

test('new messages keep sound and badge feedback wired', () => {
  assert.match(
    read('src/features/notifications/hooks/use-notification-feedback.ts'),
    /notification\.wav/,
  );
  assert.match(read('src/chat-core/app-badge.ts'), /setBadgeCountAsync/);
});

test('chat image bubble opens the full-screen viewer on tap', () => {
  const source = read('src/features/chat/components/bubbles/image-bubble.tsx');

  assert.match(source, /ImageViewer/);
  assert.match(source, /onPress=\{handleOpenPreview\}/);
  assert.match(source, /visible=\{previewVisible\}/);
  assert.match(source, /privacyMode=\{selfDestructEnabled \? 'ephemeral' : 'standard'\}/);
});

test('post expiry defaults to six hours and remains manually selectable', () => {
  const source = read('src/features/social/screens/CreatePostScreen.tsx');

  assert.match(source, /useState\(6\)/);
  assert.match(source, /value:\s*6/);
  assert.match(source, /value:\s*24/);
  assert.match(source, /selectedValue=\{expiresInHours\}/);
});

test('account settings use server-authoritative direct-message auto reply', () => {
  const appSettings = read('src/features/profile/screens/AppSettingsScreen.tsx');
  const autoReplyScreen = read(
    'src/features/profile/screens/DirectMessageAutoReplyScreen.tsx',
  );
  const privacyApi = read('src/services/api/privacy.ts');
  const store = read(
    'src/features/profile/store/use-direct-message-auto-reply-store.ts',
  );
  const dispatcher = read('src/chat-core/dispatcher.ts');

  assert.match(appSettings, /settings-auto-reply/);
  assert.match(autoReplyScreen, /DirectMessageAutoReplyScreen/);
  assert.match(autoReplyScreen, /TextInput/);
  assert.match(autoReplyScreen, /fetchPrivacySettings/);
  assert.match(autoReplyScreen, /updatePrivacySettings/);
  assert.match(autoReplyScreen, /!loaded/);
  assert.match(autoReplyScreen, /common\.retry/);
  assert.match(autoReplyScreen, /common\.save/);
  assert.doesNotMatch(autoReplyScreen, /onBlur=/);
  assert.match(privacyApi, /directMessageAutoReplyEnabled/);
  assert.match(privacyApi, /directMessageAutoReplyText/);
  assert.doesNotMatch(store, /persist\s*\(/);
  assert.doesNotMatch(store, /mmkvJsonStorage/);
  assert.doesNotMatch(dispatcher, /maybeSendDirectMessageAutoReply/);
});

test('profile contact fields use fill-in wording', () => {
  const zh = JSON.parse(read('src/i18n/locales/zh.json'));

  assert.equal(zh.profileFields.notBound, '未填写');
  assert.match(zh.profileFields.wechat, /微信/);
  assert.match(zh.profileFields.qq, /QQ/);
});

test('add-friend QR entry reaches in-app personal-card sharing', () => {
  const addFriend = read('src/features/social/screens/AddFriendScreen.tsx');
  const qr = read('src/features/qr/screens/QrCodeScreen.tsx');

  assert.match(addFriend, /handleOpenMyQr/);
  assert.match(addFriend, /handleOpenScan/);
  assert.match(qr, /ShareQrSheet/);
  assert.match(qr, /handleShare/);
});

test('friend-tag list can create a tag directly', () => {
  const source = read('src/features/contacts/screens/FriendTagsScreen.tsx');

  assert.match(source, /createFriendTag/);
  assert.match(source, /newTagName/);
  assert.match(source, /createTagVisible/);
  assert.match(source, /createInFlightRef\.current/);
});

test('auto-reply status and error copy exists in every supported locale', () => {
  for (const locale of ['zh', 'en', 'ja', 'ko', 'es']) {
    const dict = JSON.parse(read(`src/i18n/locales/${locale}.json`));
    for (const key of ['loadFailed', 'saveFailed', 'unsaved']) {
      assert.ok(dict?.settingsDetails?.autoReply?.[key], `${locale} autoReply.${key}`);
    }
  }
});

test('appearance settings wire all four requested chat display controls', () => {
  const screen = read('src/features/profile/screens/AppearanceSettingsScreen.tsx');
  const settingsStore = read(
    'src/features/profile/store/use-app-settings-store.ts',
  );
  const chatPrefs = read(
    'src/features/chat/store/use-chat-preferences-store.ts',
  );
  const chat = read('src/features/chat/screens/ChatDetailScreen.tsx');
  const messages = read('src/features/messages/screens/MessagesScreen.tsx');

  for (const key of [
    'globalChatBackground',
    'hideChatAvatar',
    'mergeAvatar',
    'pinnedFoldCount',
  ]) {
    assert.match(screen, new RegExp(`settingsDetails\\.appearance\\.${key}`));
  }
  assert.match(settingsStore, /pinnedFoldCount/);
  assert.match(chatPrefs, /globalBackgroundPreference/);
  assert.match(chat, /suppressAvatar/);
  assert.match(messages, /collapsedPinnedCount/);
});
