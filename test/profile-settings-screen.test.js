const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('settings profile rows place city below birthday', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/profile/screens/SettingsScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');
  const match = source.match(
    /const PROFILE_ROW_IDS = \[([\s\S]*?)\] as const;/,
  );

  assert.ok(match, 'PROFILE_ROW_IDS should exist');

  const ids = Array.from(
    match[1].matchAll(/'([^']+)'/g),
    ([, value]) => value,
  );

  assert.deepEqual(
    ids,
    ['avatar', 'frame', 'nickname', 'gender', 'birthday', 'city', 'bio', 'wechat', 'phone', 'qq'],
  );
});

test('settings security rows place account change above password change', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/profile/screens/SettingsScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');
  const match = source.match(
    /const SECURITY_ROW_IDS = \[([\s\S]*?)\] as const;/,
  );

  assert.ok(match, 'SECURITY_ROW_IDS should exist');

  const ids = Array.from(
    match[1].matchAll(/'([^']+)'/g),
    ([, value]) => value,
  );

  assert.deepEqual(ids, ['account-id', 'password', 'security-code']);
  assert.match(source, /profile\/change-account/);
});

test('settings flow screens use i18n instead of hardcoded Chinese settings copy', () => {
  const screenFiles = [
    'src/features/profile/screens/SettingsScreen.tsx',
    'src/features/profile/screens/ChangeAccountScreen.tsx',
    'src/features/profile/screens/ChangePasswordScreen.tsx',
    'src/features/profile/screens/EditProfileFieldScreen.tsx',
    'src/features/profile/screens/ShareScreen.tsx',
  ];

  for (const relativePath of screenFiles) {
    const source = fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
    assert.match(source, /useTranslation\(/, `${relativePath} should use react-i18next`);
  }

  assert.doesNotMatch(
    fs.readFileSync(
      path.join(process.cwd(), 'src/features/profile/screens/SettingsScreen.tsx'),
      'utf8',
    ),
    /title="账号设置"|个人信息|账号与安全|切换账号|退出登录|切换语言/,
  );
  assert.doesNotMatch(
    fs.readFileSync(
      path.join(process.cwd(), 'src/features/profile/screens/ChangePasswordScreen.tsx'),
      'utf8',
    ),
    /title="修改登录密码"|当前密码|新密码|确认新密码|保存/,
  );
  assert.doesNotMatch(
    fs.readFileSync(
      path.join(process.cwd(), 'src/features/profile/screens/ChangeAccountScreen.tsx'),
      'utf8',
    ),
    /title="修改账号"|当前账号|新账号|请输入新账号|保存/,
  );
  assert.doesNotMatch(
    fs.readFileSync(
      path.join(process.cwd(), 'src/features/profile/screens/EditProfileFieldScreen.tsx'),
      'utf8',
    ),
    /title="编辑资料"|该字段暂不支持编辑|当前显示：|保存中\.\.\.|选择生日|选择省市/,
  );
  assert.doesNotMatch(
    fs.readFileSync(
      path.join(process.cwd(), 'src/features/profile/screens/ShareScreen.tsx'),
      'utf8',
    ),
    /title="分享"|分享我的二维码|邀请码|复制邀请码|分享二维码/,
  );
});

test('change account route exports its screen and wires account update flow', () => {
  const route = fs.readFileSync(
    path.join(process.cwd(), 'app/(tabs)/profile/change-account.tsx'),
    'utf8',
  );
  const screen = fs.readFileSync(
    path.join(process.cwd(), 'src/features/profile/screens/ChangeAccountScreen.tsx'),
    'utf8',
  );

  assert.match(route, /ChangeAccountScreen/);
  assert.match(screen, /changeAccountId/);
  assert.match(screen, /setUser/);
  assert.match(screen, /profile\.accountIdInvalid/);
  assert.match(screen, /profile\.accountChangeFailed/);
});

test('app settings screen follows the requested settings detail structure', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/features/profile/screens/AppSettingsScreen.tsx'),
    'utf8',
  );

  assert.match(source, /NavHeader title=\{t\('appSettings\.title'\)\}/);
  assert.match(source, /appSettings\.searchPlaceholder/);
  assert.match(source, /appSettings\.accountSection/);
  assert.match(source, /appSettings\.generalSection/);
  assert.match(source, /appSettings\.helpSection/);

  for (const key of [
    'profile',
    'accountSecurity',
    'notifications',
    'appearance',
    'language',
    'privacy',
    'permissions',
    'clearCache',
    'about',
  ]) {
    assert.match(source, new RegExp(`appSettings\\.rows\\.${key}`));
  }
});

test('app settings screen opens a language picker sheet from the general section', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/features/profile/screens/AppSettingsScreen.tsx'),
    'utf8',
  );

  assert.match(source, /OptionPickerSheet/);
  assert.match(source, /setLanguage/);
  assert.match(source, /id:\s*'language'/);
  assert.match(source, /languageSheetVisible/);
  assert.match(source, /handleOpenLanguageSheet/);
  assert.match(source, /handleSelectLanguage/);
  assert.match(source, /getCurrentLanguagePreference/);
  assert.match(source, /type AppLanguagePreference/);
  assert.match(source, /appSettings\.languageSheet\.title/);
  assert.match(source, /appSettings\.languageSheet\.system/);
  assert.match(source, /appSettings\.languageSheet\.zh/);
  assert.match(source, /appSettings\.languageSheet\.en/);
  assert.doesNotMatch(source, /handleToggleLanguage/);
});

test('profile settings screen uses the same system language picker sheet', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/features/profile/screens/SettingsScreen.tsx'),
    'utf8',
  );

  assert.match(source, /OptionPickerSheet/);
  assert.match(source, /getCurrentLanguagePreference/);
  assert.match(source, /type AppLanguagePreference/);
  assert.match(source, /appSettings\.languageSheet\.system/);
  assert.match(source, /appSettings\.languageSheet\.zh/);
  assert.match(source, /appSettings\.languageSheet\.en/);
  assert.doesNotMatch(source, /handleToggleLanguage/);
});

test('app settings rows route to their dedicated detail pages', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/features/profile/screens/AppSettingsScreen.tsx'),
    'utf8',
  );

  for (const route of [
    'settings-account-security',
    'settings-notifications',
    'settings-appearance',
    'settings-privacy',
    'settings-permissions',
    'settings-storage',
    'settings-about',
  ]) {
    assert.match(source, new RegExp(`profile/${route}`));
  }
});

test('app settings detail routes export their screens', () => {
  const routes = {
    'app/(tabs)/profile/settings-account-security.tsx': 'AccountSecuritySettingsScreen',
    'app/(tabs)/profile/settings-notifications.tsx': 'NotificationSettingsScreen',
    'app/(tabs)/profile/settings-appearance.tsx': 'AppearanceSettingsScreen',
    'app/(tabs)/profile/settings-privacy.tsx': 'PrivacySettingsScreen',
    'app/(tabs)/profile/settings-permissions.tsx': 'SystemPermissionsScreen',
    'app/(tabs)/profile/settings-storage.tsx': 'StorageSettingsScreen',
    'app/(tabs)/profile/settings-storage-usage.tsx': 'StorageUsageScreen',
    'app/(tabs)/profile/settings-about.tsx': 'AboutSettingsScreen',
  };

  for (const [relativePath, screenName] of Object.entries(routes)) {
    const source = fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
    assert.match(source, new RegExp(screenName));
  }
});

test('app settings detail screens include the requested rows', () => {
  const expectations = {
    'src/features/profile/screens/AccountSecuritySettingsScreen.tsx': [
      'settingsDetails.accountSecurity.singleDeviceLogin',
      'settingsDetails.accountSecurity.loginDeviceManagement',
      'settingsDetails.accountSecurity.deviceLock',
      'settingsDetails.accountSecurity.wechatBinding',
      'settingsDetails.accountSecurity.cancelAccount',
    ],
    'src/features/profile/screens/NotificationSettingsScreen.tsx': [
      'settingsDetails.notifications.push',
      'settingsDetails.notifications.friendRequest',
      'settingsDetails.notifications.groupGlobal',
      'settingsDetails.notifications.circleGlobal',
      'settingsDetails.notifications.circleRingtone',
    ],
    'src/features/profile/screens/AppearanceSettingsScreen.tsx': [
      'settingsDetails.appearance.themeMode',
      'settingsDetails.appearance.displayMode',
      'settingsDetails.appearance.globalChatBackground',
      'settingsDetails.appearance.showGroupTags',
      'settingsDetails.appearance.batteryOptimization',
    ],
    'src/features/profile/screens/PrivacySettingsScreen.tsx': [
      'settingsDetails.privacy.selfDestruct',
      'settingsDetails.privacy.blacklist',
      'settingsDetails.privacy.momentsVisibility',
      'settingsDetails.privacy.showWechat',
      'settingsDetails.privacy.youthMode',
      'settingsDetails.privacy.groupInvitePermission',
    ],
    'src/features/profile/screens/SystemPermissionsScreen.tsx': [
      'settingsDetails.permissions.location',
      'settingsDetails.permissions.storage',
      'settingsDetails.permissions.microphone',
      'settingsDetails.permissions.openSystemSettings',
    ],
    'src/features/profile/screens/StorageSettingsScreen.tsx': [
      'settingsDetails.storage.storageSpace',
      'settingsDetails.storage.clearCache',
      'settingsDetails.storage.clearAllChats',
      'settingsDetails.storage.logout',
    ],
    'src/features/profile/screens/AboutSettingsScreen.tsx': [
      'settingsDetails.about.version',
      'settingsDetails.about.userAgreement',
      'settingsDetails.about.privacyPolicy',
    ],
  };

  for (const [relativePath, keys] of Object.entries(expectations)) {
    const source = fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
    for (const key of keys) {
      assert.match(source, new RegExp(key));
    }
  }
});

test('storage settings screen confirms and clears app cache', () => {
  const screenSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/profile/screens/StorageSettingsScreen.tsx'),
    'utf8',
  );
  const hookSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/profile/hooks/use-storage-actions.ts'),
    'utf8',
  );

  assert.match(screenSource, /onPress:\s*confirmClearCache/);

  assert.match(hookSource, /clearAppCache/);
  assert.match(hookSource, /Alert\.alert\(/);
  assert.match(hookSource, /settingsDetails\.storage\.clearCacheWarning/);
  assert.match(hookSource, /settingsDetails\.storage\.cacheCleared/);
});

test('storage settings screen opens storage usage and clears local chat history', () => {
  const screenSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/profile/screens/StorageSettingsScreen.tsx'),
    'utf8',
  );
  const hookSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/profile/hooks/use-storage-actions.ts'),
    'utf8',
  );

  assert.match(screenSource, /settings-storage-usage/);
  assert.match(screenSource, /useStorageActions/);
  assert.match(screenSource, /confirmClearCache/);
  assert.match(screenSource, /confirmClearChats/);

  assert.match(hookSource, /clearAllLocalMessages/);
  assert.match(hookSource, /settingsDetails\.storage\.clearAllChatsWarning/);
  assert.match(hookSource, /mountedRef/);
  assert.match(hookSource, /clearingCacheRef/);
  assert.match(hookSource, /clearingChatsRef/);
  assert.match(hookSource, /clearingCache/);
  assert.match(hookSource, /clearingChats/);
});

test('storage usage screen displays calculated storage categories', () => {
  const screenSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/profile/screens/StorageUsageScreen.tsx'),
    'utf8',
  );
  const hookSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/profile/hooks/use-storage-usage.ts'),
    'utf8',
  );

  assert.match(screenSource, /useStorageUsage/);
  assert.match(screenSource, /formatCacheSize/);
  assert.match(screenSource, /settingsDetails\.storageUsage\.chatRecords/);
  assert.match(screenSource, /settingsDetails\.storageUsage\.cacheFiles/);
  assert.match(screenSource, /settingsDetails\.storageUsage\.temporaryFiles/);
  assert.match(screenSource, /settingsDetails\.storageUsage\.total/);
  assert.match(screenSource, /loading/);
  assert.match(screenSource, /loadFailed/);
  assert.match(screenSource, /retry/);

  assert.match(hookSource, /getAppStorageUsage/);
  assert.match(hookSource, /mountedRef/);
});

test('change account screen guards duplicate submit and unmounted state updates', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/features/profile/screens/ChangeAccountScreen.tsx'),
    'utf8',
  );

  assert.match(source, /submittingRef/);
  assert.match(source, /mountedRef/);
  assert.match(source, /if \(submittingRef\.current\)/);
});

test('settings screens display calculated cache size instead of fixed i18n value', () => {
  const appSettingsSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/profile/screens/AppSettingsScreen.tsx'),
    'utf8',
  );
  const storageSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/profile/screens/StorageSettingsScreen.tsx'),
    'utf8',
  );

  assert.match(appSettingsSource, /getAppCacheSize/);
  assert.match(appSettingsSource, /formatCacheSize/);
  assert.match(appSettingsSource, /valueText:\s*cacheSizeLabel/);
  assert.doesNotMatch(appSettingsSource, /valueKey:\s*'appSettings\.cacheSize'/);
  // StorageSettingsScreen now sources cache size via the useStorageActions
  // hook; assert the screen wires the destructured label and the hook owns
  // the underlying `getAppCacheSize` call.
  const storageActionsSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/profile/hooks/use-storage-actions.ts'),
    'utf8',
  );
  assert.match(storageActionsSource, /getAppCacheSize/);
  assert.match(storageSource, /valueText:\s*cacheSizeLabel/);
  assert.doesNotMatch(storageSource, /valueKey:\s*'settingsDetails\.storage\.cacheSize'/);
});

test('app settings pages use profile settings row font scale', () => {
  const detailSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/profile/components/settings-detail.tsx'),
    'utf8',
  );
  const appSettingsSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/profile/screens/AppSettingsScreen.tsx'),
    'utf8',
  );

  assert.match(detailSource, /rowLabel:\s*\{[\s\S]*?Typography\.body/);
  assert.match(detailSource, /subtitle:\s*\{[\s\S]*?Typography\.caption/);
  assert.doesNotMatch(detailSource, /rowLabel:\s*\{[\s\S]*?Typography\.h3/);
  assert.match(appSettingsSource, /rowLabel:\s*\{[\s\S]*?Typography\.body/);
  assert.doesNotMatch(appSettingsSource, /rowLabel:\s*\{[\s\S]*?Typography\.h3/);
});

test('system announcements screen exposes latest app information and patches', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/features/profile/screens/SystemAnnouncementsScreen.tsx'),
    'utf8',
  );

  assert.match(source, /NavHeader title=\{t\('systemAnnouncements\.title'\)\}/);
  assert.match(source, /systemAnnouncements\.latestAppInfo/);
  assert.match(source, /systemAnnouncements\.updates/);
  assert.match(source, /systemAnnouncements\.patches/);
});
