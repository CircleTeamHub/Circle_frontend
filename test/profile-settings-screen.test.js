const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("settings profile rows place city below birthday", () => {
  const filePath = path.join(
    process.cwd(),
    "src/features/profile/screens/SettingsScreen.tsx",
  );
  const source = fs.readFileSync(filePath, "utf8");
  const match = source.match(
    /const PROFILE_ROW_IDS = \[([\s\S]*?)\] as const;/,
  );

  assert.ok(match, "PROFILE_ROW_IDS should exist");

  const ids = Array.from(match[1].matchAll(/'([^']+)'/g), ([, value]) => value);

  assert.deepEqual(ids, [
    "avatar",
    "nickname",
    "gender",
    "birthday",
    "city",
    "bio",
    "wechat",
    "phone",
    "qq",
  ]);
});

test("account settings page no longer owns credential security rows", () => {
  const filePath = path.join(
    process.cwd(),
    "src/features/profile/screens/SettingsScreen.tsx",
  );
  const source = fs.readFileSync(filePath, "utf8");

  assert.doesNotMatch(source, /SECURITY_ROW_IDS/);
  assert.doesNotMatch(source, /profile\/change-account/);
  assert.doesNotMatch(source, /profile\/change-password/);
  assert.doesNotMatch(source, /profile\/change-security-code/);
});

test("settings flow screens use i18n instead of hardcoded Chinese settings copy", () => {
  const screenFiles = [
    "src/features/profile/screens/SettingsScreen.tsx",
    "src/features/profile/screens/ChangePasswordScreen.tsx",
    "src/features/profile/screens/EditProfileFieldScreen.tsx",
    "src/features/profile/screens/ShareScreen.tsx",
  ];

  for (const relativePath of screenFiles) {
    const source = fs.readFileSync(
      path.join(process.cwd(), relativePath),
      "utf8",
    );
    assert.match(
      source,
      /useTranslation\(/,
      `${relativePath} should use react-i18next`,
    );
  }

  assert.doesNotMatch(
    fs.readFileSync(
      path.join(
        process.cwd(),
        "src/features/profile/screens/SettingsScreen.tsx",
      ),
      "utf8",
    ),
    /title="账号设置"|个人信息|账号与安全|切换账号|退出登录|切换语言/,
  );
  assert.doesNotMatch(
    fs.readFileSync(
      path.join(
        process.cwd(),
        "src/features/profile/screens/ChangePasswordScreen.tsx",
      ),
      "utf8",
    ),
    /title="修改登录密码"|当前密码|新密码|确认新密码|保存/,
  );
  assert.doesNotMatch(
    fs.readFileSync(
      path.join(
        process.cwd(),
        "src/features/profile/screens/EditProfileFieldScreen.tsx",
      ),
      "utf8",
    ),
    /title="编辑资料"|该字段暂不支持编辑|保存中\.\.\.|选择生日|选择省市/,
  );
  assert.doesNotMatch(
    fs.readFileSync(
      path.join(process.cwd(), "src/features/profile/screens/ShareScreen.tsx"),
      "utf8",
    ),
    /title="分享"|分享我的二维码|邀请码|复制邀请码|分享二维码/,
  );
});

test("share screen only exposes invite code sharing without QR content", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src/features/profile/screens/ShareScreen.tsx"),
    "utf8",
  );
  const zh = JSON.parse(fs.readFileSync(
    path.join(process.cwd(), "src/i18n/locales/zh.json"),
    "utf8",
  ));
  const en = JSON.parse(fs.readFileSync(
    path.join(process.cwd(), "src/i18n/locales/en.json"),
    "utf8",
  ));

  assert.doesNotMatch(source, /react-native-qrcode-svg|QRCode|INVITE_URL/);
  assert.doesNotMatch(source, /handleShareQr|shareQrTitle|shareQrSubtitle|qrTitle|qrSubtitle/);
  assert.match(source, /copyInviteTitle/);
  assert.match(source, /handleCopyInviteCode/);
  assert.doesNotMatch(source, /CIRCLE-134273011|const INVITE_CODE/);
  assert.match(source, /user\?\.inviteCode/);
  for (const removedKey of [
    "qrTitle",
    "qrSubtitle",
    "shareQrTitle",
    "shareQrSubtitle",
    "shareMessage",
  ]) {
    assert.equal(zh.shareScreen[removedKey], undefined);
    assert.equal(en.shareScreen[removedKey], undefined);
  }
});

test("account id is system-assigned and has no mutation route or API", () => {
  assert.equal(
    fs.existsSync(path.join(process.cwd(), "app/(tabs)/profile/change-account.tsx")),
    false,
  );
  assert.equal(
    fs.existsSync(
      path.join(
        process.cwd(),
        "src/features/profile/screens/ChangeAccountScreen.tsx",
      ),
    ),
    false,
  );

  const apiSource = fs.readFileSync(
    path.join(process.cwd(), "src/services/api/auth.ts"),
    "utf8",
  );
  assert.doesNotMatch(apiSource, /changeAccountId|change-account-id/);
});

test("change security code route exports its screen and wires account-level app lock settings", () => {
  const route = fs.readFileSync(
    path.join(process.cwd(), "app/(tabs)/profile/change-security-code.tsx"),
    "utf8",
  );
  const settingsSource = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/features/profile/screens/AccountSecuritySettingsScreen.tsx",
    ),
    "utf8",
  );
  const screen = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/features/profile/screens/ChangeSecurityCodeScreen.tsx",
    ),
    "utf8",
  );

  assert.match(route, /ChangeSecurityCodeScreen/);
  assert.match(settingsSource, /profile\/change-security-code/);
  // 状态拉取归属设置页（开关），子页改为按 mode 驱动，不再自行推断 enabled
  assert.match(settingsSource, /fetchLoginSecurityCodeStatus/);
  assert.doesNotMatch(screen, /fetchLoginSecurityCodeStatus/);
  assert.match(screen, /setLoginSecurityCode/);
  assert.match(screen, /disableLoginSecurityCode/);
  assert.match(screen, /profile\.securityCodeInvalid/);
  assert.match(screen, /profile\.securityCodeSaveFailed/);
  assert.match(screen, /profile\.disableSecurityCode/);
  assert.match(screen, /secureTextEntry/);
});

test("login security code screen is mode-driven and fully separates enable, change, and disable", () => {
  const screen = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/features/profile/screens/ChangeSecurityCodeScreen.tsx",
    ),
    "utf8",
  );

  assert.doesNotMatch(screen, /setupVisible/);
  assert.doesNotMatch(screen, /shouldShowForm/);
  assert.doesNotMatch(screen, /setSetupVisible/);
  // 三种模式由路由参数决定，互不混合
  assert.match(screen, /useLocalSearchParams/);
  assert.match(screen, /mode === 'enable'/);
  assert.match(screen, /mode === 'change'/);
  assert.match(screen, /mode === 'disable'/);
  // 单一提交入口：非关闭走保存，关闭弹确认后再执行
  assert.match(screen, /onPress=\{handleSubmit\}/);
  assert.match(screen, /profile\.securityCodeChangeNotice/);
});

test("login security code status error is surfaced explicitly instead of silently treated as disabled", () => {
  const settings = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/features/profile/screens/AccountSecuritySettingsScreen.tsx",
    ),
    "utf8",
  );

  // 拉取失败 -> 显式错误态 + 文案，而不是静默当作「未开启」
  assert.match(settings, /setSecurityCodeError\(true\)/);
  assert.match(settings, /profile\.securityCodeStatusFailed/);
  assert.doesNotMatch(settings, /setSecurityCodeEnabled\(false\)/);
  assert.match(
    settings,
    /console\.warn\("\[security-code\] status check failed"/,
  );
  // 回到本页时重新拉取，保证从子页返回后开关同步
  assert.match(settings, /useFocusEffect/);
});

test("login security code accepts 4 to 6 digit numeric codes across setup and unlock", () => {
  const setupScreen = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/features/profile/screens/ChangeSecurityCodeScreen.tsx",
    ),
    "utf8",
  );
  const gate = fs.readFileSync(
    path.join(process.cwd(), "src/components/app/login-security-code-gate.tsx"),
    "utf8",
  );
  const zh = fs.readFileSync(
    path.join(process.cwd(), "src/i18n/locales/zh.json"),
    "utf8",
  );
  const en = fs.readFileSync(
    path.join(process.cwd(), "src/i18n/locales/en.json"),
    "utf8",
  );

  assert.match(setupScreen, /const SECURITY_CODE_PATTERN = \/\^\\d\{4,6\}\$\//);
  assert.match(gate, /const SECURITY_CODE_PATTERN = \/\^\\d\{4,6\}\$\//);
  assert.match(zh, /安全码必须为 4-6 位数字/);
  assert.match(zh, /请输入 4-6 位/);
  assert.match(en, /4-6 digit/);
  assert.doesNotMatch(
    zh,
    /安全码必须为 6 位数字|请输入 6 位安全码|请输入 6 位数字安全码/,
  );
  assert.doesNotMatch(
    en,
    /must be 6 digits|6-digit security code|Enter 6-digit/,
  );
});

test("root layout mounts the login security code gate above app content", () => {
  const rootLayout = fs.readFileSync(
    path.join(process.cwd(), "app/_layout.tsx"),
    "utf8",
  );

  assert.match(rootLayout, /LoginSecurityCodeGate/);
  assert.match(
    rootLayout,
    /<RootStack \/>[\s\S]*<NotificationSnackbarHost \/>[\s\S]*<LoginSecurityCodeGate \/>/,
  );
});

test("login security code gate blocks only authenticated users and verifies through backend", () => {
  const gate = fs.readFileSync(
    path.join(process.cwd(), "src/components/app/login-security-code-gate.tsx"),
    "utf8",
  );

  assert.match(gate, /useAuthStore/);
  assert.match(gate, /isAuthenticated/);
  assert.match(gate, /isLoading/);
  assert.match(gate, /onboardingRequired/);
  assert.match(gate, /AppState\.addEventListener\('change'/);
  assert.match(gate, /fetchLoginSecurityCodeStatus/);
  assert.match(gate, /verifyLoginSecurityCode/);
  assert.match(gate, /if \(!isAuthenticated \|\| isLoading \|\| onboardingRequired\)/);
  assert.match(gate, /setGateState\('locked'\)/);
  assert.match(gate, /setGateState\('unlocked'\)/);
  assert.match(gate, /profile\.unlockSecurityCode/);
});

test("login security code gate only appears after backend confirms the account has enabled it", () => {
  const gate = fs.readFileSync(
    path.join(process.cwd(), "src/components/app/login-security-code-gate.tsx"),
    "utf8",
  );

  assert.match(gate, /useState<GateState>\('unlocked'\)/);
  assert.match(gate, /status\.enabled \? 'locked' : 'unlocked'/);
  // 状态拉取失败时保留上一次已知状态（已开启 -> 保持锁定），不再静默放行
  assert.match(
    gate,
    /setGateState\(securityCodeEnabledRef\.current \? 'locked' : 'unlocked'\);\s*if \(typeof __DEV__/,
  );
  assert.match(gate, /securityCodeEnabledRef\.current/);
  assert.match(
    gate,
    /const visible =\s*isAuthenticated &&\s*!isLoading &&\s*!onboardingRequired &&\s*\(gateState === 'locked' \|\| gateState === 'verifying'\)/,
  );
});

test("app settings screen follows the requested settings detail structure", () => {
  const source = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/features/profile/screens/AppSettingsScreen.tsx",
    ),
    "utf8",
  );

  assert.match(source, /NavHeader title=\{t\('appSettings\.title'\)\}/);
  assert.match(source, /appSettings\.searchPlaceholder/);
  assert.match(source, /appSettings\.accountSection/);
  assert.match(source, /appSettings\.generalSection/);
  assert.match(source, /appSettings\.helpSection/);

  for (const key of [
    "profile",
    "accountSecurity",
    "notifications",
    "appearance",
    "privacy",
    "permissions",
    "clearCache",
    "about",
  ]) {
    assert.match(source, new RegExp(`appSettings\\.rows\\.${key}`));
  }
  assert.doesNotMatch(source, /appSettings\.rows\.language/);
});

test("app settings search filters settings rows instead of rendering a placeholder", () => {
  const source = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/features/profile/screens/AppSettingsScreen.tsx",
    ),
    "utf8",
  );
  const zh = fs.readFileSync(
    path.join(process.cwd(), "src/i18n/locales/zh.json"),
    "utf8",
  );
  const en = fs.readFileSync(
    path.join(process.cwd(), "src/i18n/locales/en.json"),
    "utf8",
  );

  assert.match(source, /TextInput/);
  assert.match(source, /const \[searchQuery, setSearchQuery\] = useState\(''\)/);
  assert.match(source, /filteredAccountRows/);
  assert.match(source, /filteredGeneralRows/);
  assert.match(source, /filteredHelpRows/);
  assert.match(source, /ACCOUNT_SEARCH_ROWS/);
  assert.match(source, /GENERAL_SEARCH_ROWS/);
  assert.match(source, /HELP_SEARCH_ROWS/);
  assert.match(source, /settingsDetails\.accountSecurity\.changePassword/);
  assert.doesNotMatch(source, /settingsDetails\.accountSecurity\.changeAccount/);
  assert.doesNotMatch(source, /profile\/change-account/);
  assert.match(source, /'friendRequest'/);
  assert.match(source, /settingsDetails\.notifications\.\$\{key\}/);
  assert.match(source, /settingsDetails\.privacy\.blacklist/);
  assert.match(source, /'camera'/);
  assert.match(source, /settingsDetails\.permissions\.\$\{key\}/);
  assert.match(source, /settingsDetails\.about\.privacyPolicy/);
  assert.match(source, /pathname:\s*'\/\(tabs\)\/profile\/edit\/\[field\]'/);
  assert.match(source, /rowMatchesSearch/);
  assert.match(source, /appSettings\.searchNoResults/);
  assert.doesNotMatch(source, /<Text style=\{d\.searchText\}>\{t\('appSettings\.searchPlaceholder'\)\}<\/Text>/);
  assert.match(zh, /"searchNoResults": "没有匹配的设置"/);
  assert.match(en, /"searchNoResults": "No matching settings"/);
});

test("app settings screen leaves language selection to the appearance detail page", () => {
  const source = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/features/profile/screens/AppSettingsScreen.tsx",
    ),
    "utf8",
  );

  assert.doesNotMatch(source, /OptionPickerSheet/);
  assert.doesNotMatch(source, /setLanguage/);
  assert.doesNotMatch(source, /id:\s*'language'/);
  assert.doesNotMatch(source, /languageSheetVisible/);
  assert.doesNotMatch(source, /handleOpenLanguageSheet/);
  assert.doesNotMatch(source, /handleSelectLanguage/);
  assert.doesNotMatch(source, /getCurrentLanguagePreference/);
  assert.doesNotMatch(source, /type AppLanguagePreference/);
  assert.doesNotMatch(source, /handleToggleLanguage/);
});

test("profile settings screen no longer owns the language picker sheet", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src/features/profile/screens/SettingsScreen.tsx"),
    "utf8",
  );

  assert.doesNotMatch(source, /OptionPickerSheet/);
  assert.doesNotMatch(source, /getCurrentLanguagePreference/);
  assert.doesNotMatch(source, /type AppLanguagePreference/);
  assert.doesNotMatch(source, /settingsPage\.language/);
  assert.doesNotMatch(source, /appSettings\.languageSheet\.system/);
  assert.doesNotMatch(source, /appSettings\.languageSheet\.zh/);
  assert.doesNotMatch(source, /appSettings\.languageSheet\.en/);
  assert.doesNotMatch(source, /handleToggleLanguage/);
});

test("account actions live at the bottom of the app settings home, not the profile detail page", () => {
  const profileSource = fs.readFileSync(
    path.join(process.cwd(), "src/features/profile/screens/SettingsScreen.tsx"),
    "utf8",
  );
  const appSettingsSource = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/features/profile/screens/AppSettingsScreen.tsx",
    ),
    "utf8",
  );

  assert.doesNotMatch(profileSource, /useAuth\(\)/);
  assert.doesNotMatch(profileSource, /switchAccount/);
  assert.doesNotMatch(profileSource, /settingsPage\.switchAccount/);
  assert.doesNotMatch(profileSource, /settingsPage\.logout/);

  assert.match(appSettingsSource, /useAuth\(\)/);
  assert.match(appSettingsSource, /const \{ logout, switchAccount, submitting \} = useAuth\(\)/);
  assert.match(appSettingsSource, /onPress=\{switchAccount\}/);
  assert.match(appSettingsSource, /onPress=\{logout\}/);
  assert.match(appSettingsSource, /settingsPage\.switchAccount/);
  assert.match(appSettingsSource, /settingsPage\.logout/);
  assert.match(appSettingsSource, /style=\{s\.footer\}/);
});

test("app settings rows route to their dedicated detail pages", () => {
  const source = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/features/profile/screens/AppSettingsScreen.tsx",
    ),
    "utf8",
  );

  for (const route of [
    "settings-account-security",
    "settings-notifications",
    "settings-appearance",
    "settings-privacy",
    "settings-permissions",
    "settings-storage",
    "settings-about",
  ]) {
    assert.match(source, new RegExp(`profile/${route}`));
  }
});

test("app settings detail routes export their screens", () => {
  const routes = {
    "app/(tabs)/profile/settings-account-security.tsx":
      "AccountSecuritySettingsScreen",
    "app/(tabs)/profile/login-devices.tsx": "LoginDeviceManagementScreen",
    "app/(tabs)/profile/settings-notifications.tsx":
      "NotificationSettingsScreen",
    "app/(tabs)/profile/settings-appearance.tsx": "AppearanceSettingsScreen",
    "app/(tabs)/profile/settings-privacy.tsx": "PrivacySettingsScreen",
    "app/(tabs)/profile/settings-blacklist.tsx": "BlacklistSettingsScreen",
    "app/(tabs)/profile/settings-permissions.tsx": "SystemPermissionsScreen",
    "app/(tabs)/profile/settings-storage.tsx": "StorageSettingsScreen",
    "app/(tabs)/profile/settings-storage-usage.tsx": "StorageUsageScreen",
    "app/(tabs)/profile/settings-about.tsx": "AboutSettingsScreen",
    "app/(tabs)/profile/settings-about-product.tsx": "AboutProductScreen",
    "app/(tabs)/profile/settings-about-user-agreement.tsx":
      "AboutUserAgreementScreen",
    "app/(tabs)/profile/settings-about-privacy-policy.tsx":
      "AboutPrivacyPolicyScreen",
    "app/(tabs)/profile/settings-about-version.tsx": "AboutVersionScreen",
  };

  for (const [relativePath, screenName] of Object.entries(routes)) {
    const source = fs.readFileSync(
      path.join(process.cwd(), relativePath),
      "utf8",
    );
    assert.match(source, new RegExp(screenName));
  }
});

test("app settings detail screens include the requested rows", () => {
  const expectations = {
    "src/features/profile/screens/AccountSecuritySettingsScreen.tsx": [
      "settingsDetails.accountSecurity.changePassword",
      "settingsDetails.accountSecurity.securityCode",
      "settingsDetails.accountSecurity.singleDeviceLogin",
      "settingsDetails.accountSecurity.loginDeviceManagement",
      "settingsDetails.accountSecurity.cancelAccount",
    ],
    "src/features/profile/screens/NotificationSettingsScreen.tsx": [
      "settingsDetails.notifications.push",
      "settingsDetails.notifications.friendRequest",
      "settingsDetails.notifications.groupGlobal",
      "settingsDetails.notifications.circleGlobal",
      "settingsDetails.notifications.circleRingtone",
    ],
    "src/features/profile/screens/AppearanceSettingsScreen.tsx": [
      "settingsDetails.appearance.themeMode",
      "settingsDetails.appearance.language",
    ],
    "src/features/profile/screens/PrivacySettingsScreen.tsx": [
      "settingsDetails.privacy.selfDestruct",
      "settingsDetails.privacy.blacklist",
      "settingsDetails.privacy.momentsVisibility",
      "settingsDetails.privacy.showWechat",
      "settingsDetails.privacy.groupInvitePermission",
    ],
    "src/features/profile/screens/SystemPermissionsScreen.tsx": [
      "settingsDetails.permissions.location",
      "settingsDetails.permissions.microphone",
      "settingsDetails.permissions.openSystemSettings",
    ],
    "src/features/profile/screens/StorageSettingsScreen.tsx": [
      "settingsDetails.storage.storageSpace",
      "settingsDetails.storage.clearCache",
      "settingsDetails.storage.clearAllChats",
    ],
    "src/features/profile/screens/AboutSettingsScreen.tsx": [
      "settingsDetails.about.version",
      "settingsDetails.about.userAgreement",
      "settingsDetails.about.privacyPolicy",
      "settingsDetails.about.productIntro",
      "settingsDetails.about.checkUpdates",
    ],
  };

  for (const [relativePath, keys] of Object.entries(expectations)) {
    const source = fs.readFileSync(
      path.join(process.cwd(), relativePath),
      "utf8",
    );
    for (const key of keys) {
      assert.match(source, new RegExp(key));
    }
  }
});

test("about settings screen presents real product content", () => {
  const source = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/features/profile/screens/AboutSettingsScreen.tsx",
    ),
    "utf8",
  );

  assert.match(source, /expo-constants/);
  assert.match(source, /useRouter/);
  assert.match(source, /settings-about-product/);
  assert.match(source, /settings-about-user-agreement/);
  assert.match(source, /settings-about-privacy-policy/);
  assert.match(source, /settings-about-version/);
  assert.doesNotMatch(source, /footer=/);
});

test("about detail content is split into dedicated screens", () => {
  const expectations = {
    "src/features/profile/screens/AboutProductScreen.tsx": [
      "settingsDetails.about.brandName",
      "settingsDetails.about.tagline",
      "settingsDetails.about.description",
      "settingsDetails.about.capabilitiesTitle",
    ],
    "src/features/profile/screens/AboutUserAgreementScreen.tsx": [
      "settingsDetails.about.agreementTitle",
      "settingsDetails.about.agreementBody",
    ],
    "src/features/profile/screens/AboutPrivacyPolicyScreen.tsx": [
      "settingsDetails.about.policyTitle",
      "settingsDetails.about.policyBody",
    ],
    "src/features/profile/screens/AboutVersionScreen.tsx": [
      "settingsDetails.about.updateTitle",
      "settingsDetails.about.updateBody",
    ],
  };

  for (const [relativePath, keys] of Object.entries(expectations)) {
    const source = fs.readFileSync(
      path.join(process.cwd(), relativePath),
      "utf8",
    );
    for (const key of keys) {
      assert.match(source, new RegExp(key));
    }
  }
});

test("about settings copy is localized", () => {
  const zh = fs.readFileSync(
    path.join(process.cwd(), "src/i18n/locales/zh.json"),
    "utf8",
  );
  const en = fs.readFileSync(
    path.join(process.cwd(), "src/i18n/locales/en.json"),
    "utf8",
  );

  for (const key of [
    "brandName",
    "tagline",
    "description",
    "capabilitiesTitle",
    "privacyTitle",
    "agreementTitle",
    "policyTitle",
    "updateTitle",
  ]) {
    assert.match(zh, new RegExp(`"${key}"`));
    assert.match(en, new RegExp(`"${key}"`));
  }
  assert.match(zh, /为真实关系设计的即时通讯/);
  assert.match(en, /Designed for real relationships/);
});

test("about legal copy uses professional agreement and privacy sections", () => {
  const zh = fs.readFileSync(
    path.join(process.cwd(), "src/i18n/locales/zh.json"),
    "utf8",
  );

  for (const phrase of [
    "适用范围",
    "账号与安全",
    "用户行为规范",
    "知识产权",
    "个人信息的收集与使用",
    "共享、转让与公开披露",
    "用户权利",
    "未成年人保护",
  ]) {
    assert.match(zh, new RegExp(phrase));
  }
});

test("account security detail omits lock code and WeChat binding placeholders", () => {
  const source = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/features/profile/screens/AccountSecuritySettingsScreen.tsx",
    ),
    "utf8",
  );

  assert.doesNotMatch(source, /settingsDetails\.accountSecurity\.deviceLock/);
  assert.doesNotMatch(
    source,
    /settingsDetails\.accountSecurity\.wechatBinding/,
  );
  assert.doesNotMatch(source, /id:\s*'device-lock'/);
  assert.doesNotMatch(source, /id:\s*'wechat-binding'/);
  assert.doesNotMatch(source, /setSetting\('deviceLock'/);
});

test("account security detail owns credential change routes", () => {
  const source = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/features/profile/screens/AccountSecuritySettingsScreen.tsx",
    ),
    "utf8",
  );

  assert.match(source, /id:\s*["']change-password["']/);
  // 登录安全码已拆分为「开启（开关）」与「修改（链接）」两行
  assert.match(source, /id:\s*["']enable-security-code["']/);
  assert.match(source, /id:\s*["']change-security-code["']/);
  assert.doesNotMatch(source, /id:\s*["']change-account["']/);
  assert.doesNotMatch(source, /profile\/change-account/);
  assert.match(source, /profile\/change-password/);
  assert.match(source, /profile\/change-security-code/);
});

test("account security uses backend-backed device management and single-device login", () => {
  const source = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/features/profile/screens/AccountSecuritySettingsScreen.tsx",
    ),
    "utf8",
  );

  assert.match(source, /fetchSingleDeviceLoginStatus/);
  assert.match(source, /setSingleDeviceLogin/);
  assert.match(source, /login-devices/);
  assert.match(source, /id:\s*["']login-device-management["']/);
  assert.match(source, /value:\s*singleDeviceLogin/);
  assert.doesNotMatch(source, /useAppSettingsStore/);
  assert.doesNotMatch(source, /setSetting\('singleDeviceLogin'/);
});

test("privacy settings omits removed placeholder and presence rows", () => {
  const source = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/features/profile/screens/PrivacySettingsScreen.tsx",
    ),
    "utf8",
  );

  for (const removed of [
    "selfDestructTip",
    "onlineTime",
    "singleTyping",
    "groupTyping",
    "personalizedRecommendation",
    "youthMode",
  ]) {
    assert.doesNotMatch(source, new RegExp(`settingsDetails\\.privacy\\.${removed}`));
    assert.doesNotMatch(source, new RegExp(`setSetting\\('${removed}'`));
  }
});

test("privacy settings are backed by account privacy APIs instead of local placeholders", () => {
  const source = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/features/profile/screens/PrivacySettingsScreen.tsx",
    ),
    "utf8",
  );

  assert.match(source, /fetchPrivacySettings/);
  assert.match(source, /updatePrivacySettings/);
  assert.match(source, /OptionPickerSheet/);
  assert.match(source, /profile\/settings-blacklist/);
  assert.doesNotMatch(source, /useAppSettingsStore/);
  assert.doesNotMatch(source, /setSetting\(/);
});

test("blacklist settings screen uses the real blacklist APIs", () => {
  const source = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/features/profile/screens/BlacklistSettingsScreen.tsx",
    ),
    "utf8",
  );

  assert.match(source, /fetchBlockedUsers/);
  assert.match(source, /removeFriendFromBlacklist/);
  assert.doesNotMatch(source, /settingsPage\.unsupported/);
});

test("system permissions screen queries native permission APIs instead of hardcoded states", () => {
  const source = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/features/profile/screens/SystemPermissionsScreen.tsx",
    ),
    "utf8",
  );

  assert.match(source, /from 'expo-location'/);
  assert.match(source, /from 'expo-camera'/);
  assert.match(source, /from 'expo-image-picker'/);
  assert.match(source, /from 'expo-audio'/);
  assert.match(source, /import\('expo-notifications'\)/);
  assert.match(source, /loadNotificationsModule/);
  assert.match(source, /getForegroundPermissionsAsync/);
  assert.match(source, /requestForegroundPermissionsAsync/);
  assert.match(source, /getCameraPermissionsAsync/);
  assert.match(source, /requestCameraPermissionsAsync/);
  assert.match(source, /getMediaLibraryPermissionsAsync/);
  assert.match(source, /requestMediaLibraryPermissionsAsync/);
  assert.match(source, /getRecordingPermissionsAsync/);
  assert.match(source, /requestRecordingPermissionsAsync/);
  assert.match(source, /notifications\.getPermissionsAsync/);
  assert.match(source, /notifications\.requestPermissionsAsync/);
  assert.match(source, /refreshPermissions/);
  assert.match(source, /requestPermission/);
  assert.match(source, /Linking\.openSettings/);
  assert.doesNotMatch(source, /statusKey:\s*'settingsDetails\.permissions\.authorized'/);
});

test("system permissions screen lazy-loads notifications so missing native modules do not crash the page", () => {
  const source = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/features/profile/screens/SystemPermissionsScreen.tsx",
    ),
    "utf8",
  );

  assert.doesNotMatch(
    source,
    /import\s+\*\s+as\s+Notifications\s+from\s+['"]expo-notifications['"]/,
  );
  assert.match(source, /catch \(error\)/);
  assert.match(source, /console\.warn\('\[permissions\] notifications module unavailable'/);
  assert.match(source, /if \(!notifications\)/);
});

test("system permissions screen omits misleading storage permission", () => {
  const source = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/features/profile/screens/SystemPermissionsScreen.tsx",
    ),
    "utf8",
  );

  assert.doesNotMatch(source, /'storage'/);
  assert.doesNotMatch(source, /ANDROID_STORAGE_PERMISSIONS/);
  assert.doesNotMatch(source, /settingsDetails\.permissions\.storage/);
  assert.doesNotMatch(source, /READ_MEDIA_IMAGES|READ_MEDIA_VIDEO|READ_EXTERNAL_STORAGE/);
});

test("system permissions screen omits unsupported bluetooth permission", () => {
  const source = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/features/profile/screens/SystemPermissionsScreen.tsx",
    ),
    "utf8",
  );

  assert.doesNotMatch(source, /'bluetooth'/);
  assert.doesNotMatch(source, /ANDROID_BLUETOOTH_PERMISSIONS/);
  assert.doesNotMatch(source, /settingsDetails\.permissions\.bluetooth/);
  assert.doesNotMatch(source, /BLUETOOTH_CONNECT|BLUETOOTH_SCAN/);
});

test("system permissions screen uses primary purple accents and a real settings button", () => {
  const screenSource = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/features/profile/screens/SystemPermissionsScreen.tsx",
    ),
    "utf8",
  );
  const detailSource = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/features/profile/components/settings-detail.tsx",
    ),
    "utf8",
  );

  assert.match(screenSource, /iconColor:\s*colors\.primary/);
  assert.match(screenSource, /iconBackgroundColor:\s*colors\.primaryLight/);
  assert.match(screenSource, /statusColor:\s*colors\.primary/);
  assert.match(screenSource, /settingsButton/);
  assert.match(screenSource, /backgroundColor:\s*colors\.primary/);
  assert.match(screenSource, /color:\s*colors\.white/);
  assert.match(detailSource, /iconColor\?:\s*string/);
  assert.match(detailSource, /statusColor\?:\s*string/);
});

test("notification permission implementation depends on expo notifications", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
  );

  assert.match(pkg.dependencies["expo-notifications"], /^~/);
});

test("login device management screen lists sessions and supports device logout actions", () => {
  const route = fs.readFileSync(
    path.join(process.cwd(), "app/(tabs)/profile/login-devices.tsx"),
    "utf8",
  );
  const screen = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/features/profile/screens/LoginDeviceManagementScreen.tsx",
    ),
    "utf8",
  );

  assert.match(route, /LoginDeviceManagementScreen/);
  assert.match(screen, /fetchAuthSessions/);
  assert.match(screen, /revokeAuthSession/);
  assert.match(screen, /logoutOtherSessions/);
  assert.match(screen, /clearLocalSession/);
  assert.match(screen, /isCurrent/);
  assert.match(screen, /settingsDetails\.accountSecurity\.deviceManagement/);
  assert.doesNotMatch(screen, /deviceManagement\.ip/);
  assert.doesNotMatch(screen, /deviceManagement\.userAgent/);
  assert.doesNotMatch(screen, /deviceManagement\.expiresAt/);
});

test("storage settings screen confirms and clears app cache", () => {
  const screenSource = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/features/profile/screens/StorageSettingsScreen.tsx",
    ),
    "utf8",
  );
  const hookSource = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/features/profile/hooks/use-storage-actions.ts",
    ),
    "utf8",
  );

  assert.match(screenSource, /onPress:\s*confirmClearCache/);

  assert.match(hookSource, /clearAppCache/);
  assert.match(hookSource, /Alert\.alert\(/);
  assert.match(hookSource, /settingsDetails\.storage\.clearCacheWarning/);
  assert.match(hookSource, /settingsDetails\.storage\.cacheCleared/);
});

test("storage settings screen opens storage usage and clears local chat history", () => {
  const screenSource = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/features/profile/screens/StorageSettingsScreen.tsx",
    ),
    "utf8",
  );
  const hookSource = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/features/profile/hooks/use-storage-actions.ts",
    ),
    "utf8",
  );

  assert.match(screenSource, /settings-storage-usage/);
  assert.match(screenSource, /useStorageActions/);
  assert.match(screenSource, /confirmClearCache/);
  assert.match(screenSource, /confirmClearChats/);

  // 契约随自研栈迁移更新(意图不变):清聊天 = 清内存缓存 + 旧 OpenIM 遗留目录。
  // 必须是 clearCachedChats 而不是 reset:socket 还连着时 reset 会清掉
  // currentUserId，之后收到的消息判不出收发方向、未读也算错。
  assert.match(hookSource, /useChatStore\.getState\(\)\.clearCachedChats\(\)/);
  assert.doesNotMatch(hookSource, /useChatStore\.getState\(\)\.reset\(\)/);
  assert.match(hookSource, /clearLegacyImData/);
  assert.match(hookSource, /settingsDetails\.storage\.clearAllChatsWarning/);
  assert.match(hookSource, /mountedRef/);
  assert.match(hookSource, /clearingCacheRef/);
  assert.match(hookSource, /clearingChatsRef/);
  assert.match(hookSource, /clearingCache/);
  assert.match(hookSource, /clearingChats/);
});

test("storage usage screen displays calculated storage categories", () => {
  const screenSource = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/features/profile/screens/StorageUsageScreen.tsx",
    ),
    "utf8",
  );
  const hookSource = fs.readFileSync(
    path.join(process.cwd(), "src/features/profile/hooks/use-storage-usage.ts"),
    "utf8",
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

test("settings screens display calculated cache size instead of fixed i18n value", () => {
  const appSettingsSource = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/features/profile/screens/AppSettingsScreen.tsx",
    ),
    "utf8",
  );
  const storageSource = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/features/profile/screens/StorageSettingsScreen.tsx",
    ),
    "utf8",
  );

  assert.match(appSettingsSource, /getAppCacheSize/);
  assert.match(appSettingsSource, /formatCacheSize/);
  assert.match(appSettingsSource, /valueText:\s*cacheSizeLabel/);
  assert.doesNotMatch(
    appSettingsSource,
    /valueKey:\s*'appSettings\.cacheSize'/,
  );
  // StorageSettingsScreen now sources cache size via the useStorageActions
  // hook; assert the screen wires the destructured label and the hook owns
  // the underlying `getAppCacheSize` call.
  const storageActionsSource = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/features/profile/hooks/use-storage-actions.ts",
    ),
    "utf8",
  );
  assert.match(storageActionsSource, /getAppCacheSize/);
  assert.match(storageSource, /valueText:\s*cacheSizeLabel/);
  assert.doesNotMatch(
    storageSource,
    /valueKey:\s*'settingsDetails\.storage\.cacheSize'/,
  );
});

test("app settings pages use profile settings row font scale", () => {
  const detailSource = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/features/profile/components/settings-detail.tsx",
    ),
    "utf8",
  );
  const appSettingsSource = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/features/profile/screens/AppSettingsScreen.tsx",
    ),
    "utf8",
  );

  assert.match(detailSource, /rowLabel:\s*\{[\s\S]*?Typography\.body/);
  assert.match(detailSource, /subtitle:\s*\{[\s\S]*?Typography\.caption/);
  assert.doesNotMatch(detailSource, /rowLabel:\s*\{[\s\S]*?Typography\.h3/);
  assert.match(appSettingsSource, /rowLabel:\s*\{[\s\S]*?Typography\.body/);
  assert.doesNotMatch(
    appSettingsSource,
    /rowLabel:\s*\{[\s\S]*?Typography\.h3/,
  );
});

test("notification settings toggles are backed by persisted app settings instead of local placeholders", () => {
  const storeSource = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/features/profile/store/use-app-settings-store.ts",
    ),
    "utf8",
  );

  assert.match(storeSource, /persist\(/);
  assert.match(storeSource, /createJSONStorage\(\(\) => mmkvJsonStorage\)/);
  assert.match(storeSource, /circle-im-app-settings/);
  assert.match(storeSource, /setSetting:\s*\(key, value\)/);

  const source = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/features/profile/screens/NotificationSettingsScreen.tsx",
    ),
    "utf8",
  );
  assert.match(source, /useAppSettingsStore/);
  assert.match(source, /value:/);
  assert.match(source, /onValueChange:/);
  assert.doesNotMatch(source, /initialValue:/);
});

test("appearance settings only controls theme and language preferences", () => {
  const source = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/features/profile/screens/AppearanceSettingsScreen.tsx",
    ),
    "utf8",
  );

  assert.match(source, /useTheme\(\)/);
  assert.match(source, /setThemeMode/);
  assert.match(source, /setLanguage/);
  assert.match(source, /getCurrentLanguagePreference/);
  assert.match(source, /APP_LANGUAGE_OPTIONS/);
  assert.match(source, /OptionPickerSheet/);
  assert.match(source, /selectedValue=\{themeMode\}/);
  assert.match(source, /selectedValue=\{languagePreference\}/);
  assert.match(source, /settingsDetails\.appearance\.themeSheet\.system/);
  assert.match(source, /settingsDetails\.appearance\.themeSheet\.light/);
  assert.match(source, /settingsDetails\.appearance\.themeSheet\.dark/);
  assert.match(source, /APP_LANGUAGE_OPTIONS\.map/);
  assert.doesNotMatch(source, /value:\s*'zh'[\s\S]*value:\s*'en'/);
  for (const removedKey of [
    "displayMode",
    "fontSize",
    "globalChatBackground",
    "hideChatAvatar",
    "mergeAvatar",
    "showGroupTags",
    "showOriginalGroupName",
    "pinnedFoldCount",
    "batteryOptimization",
  ]) {
    assert.doesNotMatch(source, new RegExp(`settingsDetails\\.appearance\\.${removedKey}`));
  }
  assert.doesNotMatch(source, /useAppSettingsStore/);
});

test("account security settings reuse real auth actions", () => {
  const accountSource = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/features/profile/screens/AccountSecuritySettingsScreen.tsx",
    ),
    "utf8",
  );

  assert.match(accountSource, /useAuth\(\)/);
  assert.match(accountSource, /onPress:\s*switchAccount/);
  assert.match(accountSource, /onPress:\s*logout/);
});

test("storage settings only contains storage actions and omits account actions", () => {
  const storageSource = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/features/profile/screens/StorageSettingsScreen.tsx",
    ),
    "utf8",
  );

  assert.match(storageSource, /settings-storage-usage/);
  assert.match(storageSource, /confirmClearCache/);
  assert.match(storageSource, /confirmClearChats/);
  assert.doesNotMatch(storageSource, /useAuth\(\)/);
  assert.doesNotMatch(storageSource, /switchAccount/);
  assert.doesNotMatch(storageSource, /logout/);
  assert.doesNotMatch(storageSource, /settingsDetails\.storage\.switchAccount/);
  assert.doesNotMatch(storageSource, /settingsDetails\.storage\.logout/);
});

test("system announcements screen exposes latest app information and patches", () => {
  const source = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/features/profile/screens/SystemAnnouncementsScreen.tsx",
    ),
    "utf8",
  );

  assert.match(source, /NavHeader title=\{t\('systemAnnouncements\.title'\)\}/);
  assert.match(source, /systemAnnouncements\.latestAppInfo/);
  assert.match(source, /systemAnnouncements\.updates/);
  assert.match(source, /systemAnnouncements\.patches/);
  assert.match(source, /fetchProfileNotifications/);
  assert.match(source, /markProfileNotificationsRead/);
  assert.match(source, /FlatList/);
  assert.match(source, /systemAnnouncements\.empty/);
});

test("language picker and settings rows allow long translated labels", () => {
  const pickerSource = fs.readFileSync(
    path.join(process.cwd(), "src/components/ui/option-picker-sheet.tsx"),
    "utf8",
  );
  const settingsDetailSource = fs.readFileSync(
    path.join(process.cwd(), "src/features/profile/components/settings-detail.tsx"),
    "utf8",
  );

  assert.match(pickerSource, /optionRow:\s*\{[\s\S]*minHeight:\s*52/);
  assert.match(pickerSource, /optionLabel:\s*\{[\s\S]*flexShrink:\s*1/);
  assert.match(pickerSource, /numberOfLines=\{2\}/);
  assert.match(settingsDetailSource, /rowRight:\s*\{[\s\S]*flexShrink:\s*1/);
  assert.match(settingsDetailSource, /value:\s*\{[\s\S]*textAlign:\s*'right'/);
  assert.match(settingsDetailSource, /numberOfLines=\{2\}/);
});

test("every locale defines labels for all supported language picker options", () => {
  const localeCodes = ["zh", "en", "ja", "ko", "es"];
  const languageSheetKeys = ["title", "system", "zh", "en", "ja", "ko", "es"];

  for (const localeCode of localeCodes) {
    const locale = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), `src/i18n/locales/${localeCode}.json`),
        "utf8",
      ),
    );
    const languageSheet = locale.appSettings?.languageSheet ?? {};
    const missing = languageSheetKeys.filter((key) => !languageSheet[key]);

    assert.deepEqual(
      missing,
      [],
      `${localeCode}.json appSettings.languageSheet is missing: ${missing.join(", ")}`,
    );
  }
});

// 「加我为好友的方式」摘要里的计数必须只算界面上真的能拨的那几项。
// byPhone / byQrCode 的开关已撤下（对应功能不存在），但字段仍会随服务端返回，
// 且 addMeByQrCode 的默认值是 true —— 把它们算进去，用户会看到「已开启 3 项」，
// 点开却只有两个开关，多出来的那一项既看不到也改不了。
test("add-me summary counts only the methods whose switches are rendered", () => {
  const source = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/features/profile/screens/PrivacySettingsScreen.tsx",
    ),
    "utf8",
  );

  const countBlock = source.match(/const addMeCount = \[([\s\S]*?)\]/);
  assert.ok(countBlock, "addMeCount array literal not found");

  const counted = [...countBlock[1].matchAll(/currentSettings\.(addMe\w+)/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(
    counted.sort(),
    ["addMeByAccount", "addMeByGroup"],
    "addMeCount must exclude methods that have no switch in the sheet",
  );

  // 反向咬合：真有开关的项一个都不能漏算，否则计数会低于可见开关数。
  const switched = [
    ...source.matchAll(/onChange\(\{\s*(addMe\w+):/g),
  ].map((match) => match[1]);
  assert.deepEqual(
    switched.sort(),
    counted.sort(),
    "every rendered add-me switch must be counted, and vice versa",
  );
});

test("privacy self-destruct updates the chat cache policy immediately", () => {
  const source = fs.readFileSync(
    path.join(
      process.cwd(),
      "src/features/profile/screens/PrivacySettingsScreen.tsx",
    ),
    "utf8",
  );

  assert.match(source, /useChatStore/);
  assert.match(
    source,
    /setViewerSelfDestructDays\(updated\.messageSelfDestructDays\)/,
  );
});
