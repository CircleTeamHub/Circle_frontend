const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadTsModule } = require("./helpers/load-ts-module");

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("known accounts store persists saved account tokens in SecureStore via pure helpers", () => {
  const store = read("src/stores/knownAccountsStore.ts");

  assert.match(store, /name:\s*['"]circle-im-known-accounts['"]/);
  assert.match(store, /secureAuthStorage/);
  assert.doesNotMatch(store, /mmkvJsonStorage/);
  assert.match(store, /upsertKnownAccount/);
  assert.match(store, /removeKnownAccount/);
  // 持久化字段包含 token（支持免密快速切号）；用户 PII 在落盘前经
  // sanitizeUserForPersist 清空（C-05），因此 partialize 会 map 每个 account。
  assert.match(store, /partialize:\s*\(state\)\s*=>\s*\(\{/);
  assert.match(store, /accounts:\s*state\.accounts\.map/);
  assert.match(store, /user:\s*sanitizeUserForPersist\(account\.user\)/);

  const logic = read("src/stores/knownAccountsLogic.ts");
  // 纯逻辑文件只能 import type，运行时不得拉入 SecureStore/MMKV/authStore
  assert.match(logic, /import type \{ AuthUser \}/);
  assert.doesNotMatch(logic, /from '@\/storage'/);
  assert.doesNotMatch(logic, /secure-auth-storage/);
});

test("account switcher store is a runtime-only open/close toggle (not persisted)", () => {
  const store = read("src/stores/accountSwitcherStore.ts");
  assert.match(store, /isOpen/);
  assert.match(store, /open:/);
  assert.match(store, /close:/);
  assert.doesNotMatch(store, /persist\(/);
});

test("switch account opens the sheet instead of logging out", () => {
  const useAuth = read("src/hooks/use-auth.ts");

  // 「切换账号」= 打开 sheet，不再走 endSession 登出
  assert.match(
    useAuth,
    /const switchAccount = useCallback\(\(\) => \{\s*useAccountSwitcherStore\.getState\(\)\.open\(\);/,
  );
  // 登录成功记入本设备账号列表
  assert.match(useAuth, /upsertAccount\(\{[\s\S]*accessToken: tokens\.accessToken/);
  // 退出 = 从列表移除当前账号
  assert.match(useAuth, /removeAccount\(currentId\)/);
});

test("logout clears session once and lets the auth route guard navigate to login", () => {
  const useAuth = read("src/hooks/use-auth.ts");
  const endSession = useAuth.slice(
    useAuth.indexOf("const endSession = useCallback"),
    useAuth.indexOf("const logout = useCallback"),
  );

  assert.match(endSession, /await clearLocalSession\(\)/);
  assert.doesNotMatch(endSession, /router\.replace\(['"]\/\(auth\)\/login['"]\)/);
});

test("switch-to-account validates the session and falls back to login on expiry", () => {
  const useAuth = read("src/hooks/use-auth.ts");

  assert.match(useAuth, /switchToAccount/);
  // 拆旧会话 -> 激活存储 token -> 校验 /auth/me（401 自动续期）
  assert.match(useAuth, /await clearLocalSession\(\)/);
  assert.match(useAuth, /retry\(\(\) => fetchCurrentUser\(\)\)/);
  // 过期分支：移除死账号 + 跳登录页并预填邮箱。登录已改为邮箱制，
  // 登录表单只有 email 输入框，故预填 email 而非 accountId。
  assert.match(useAuth, /removeAccount\(account\.user\.id\)/);
  assert.match(
    useAuth,
    /pathname:\s*['"]\/\(auth\)\/login['"][\s\S]*email:\s*account\.user\.email/,
  );
});

test("degraded switch (transient /auth/me failure) keeps rotated tokens and retries IM (review)", () => {
  const useAuth = read("src/hooks/use-auth.ts");

  // 降级分支（isDefinitiveAuthFailure 为 false 的 else 段）
  const elseBranch = useAuth.slice(
    useAuth.indexOf("账号列表保持完整"),
    useAuth.indexOf("router.replace('/(tabs)/messages');", useAuth.indexOf("账号列表保持完整")),
  );
  assert.ok(elseBranch.length > 0, "degraded branch exists");
  // ① 401 前置续期轮换过的 token 必须写回账号列表 —— 否则回切用旧
  //    refreshToken 撞 401，好账号被误删
  assert.match(elseBranch, /upsertAccount\(\{[\s\S]*user: account\.user/);
  assert.match(elseBranch, /updatedAt: Date\.now\(\)/);
  // ② clearLocalSession 已登出 OpenIM 且 bootstrap 不会再补登 —— 降级进入
  //    也要尽力 IM 重连 + 拉会话分组
  assert.match(elseBranch, /loginToOpenIM\(account\.user\.id, imToken\)/);
  assert.match(elseBranch, /useMessageGroupsStore\.getState\(\)\.load\(\)/);
  // ③ round 2：这次 IM 登录也失败时挂共享补登欠账（bootstrap 回前台消费）
  assert.match(elseBranch, /markIMLoginRetryPending\(\)/);
});

test('IM 补登欠账为模块级共享：use-auth 生产、bootstrap 消费 (round 2)', () => {
  const pendingMod = read('src/im/login-retry-pending.ts');
  assert.match(pendingMod, /markIMLoginRetryPending/);
  assert.match(pendingMod, /isIMLoginRetryPending/);
  assert.match(pendingMod, /clearIMLoginRetryPending/);

  const bootstrap = read('src/components/app/session-bootstrap.tsx');
  // bootstrap 不再持组件私有 ref，改用共享标记：成功清、失败记、回前台查
  assert.doesNotMatch(bootstrap, /openIMLoginPendingRef/);
  assert.match(bootstrap, /clearIMLoginRetryPending\(\)/);
  assert.match(bootstrap, /markIMLoginRetryPending\(\)/);
  assert.match(bootstrap, /if \(isIMLoginRetryPending\(\)\)/);

  // 行为：mark → is=true → clear → is=false
  const mod = loadTsModule('src/im/login-retry-pending.ts');
  assert.equal(mod.isIMLoginRetryPending(), false);
  mod.markIMLoginRetryPending();
  assert.equal(mod.isIMLoginRetryPending(), true);
  mod.clearIMLoginRetryPending();
  assert.equal(mod.isIMLoginRetryPending(), false);
});

test("account switcher sheet lists accounts and offers an add-account entry", () => {
  const sheet = read("src/features/profile/components/account-switcher-sheet.tsx");

  assert.match(sheet, /useKnownAccountsStore/);
  assert.match(sheet, /useAccountSwitcherStore/);
  assert.match(sheet, /switchToAccount/);
  assert.match(sheet, /accountSwitcher\.title/);
  assert.match(sheet, /accountSwitcher\.addAccount/);
  // 添加账号 -> 登录页
  assert.match(sheet, /router\.push\(['"]\/\(auth\)\/login['"]\)/);
  // 当前账号标记 + 头像
  assert.match(sheet, /accountSwitcher\.current/);
  assert.match(sheet, /<Avatar/);
});

test("the account switcher sheet is mounted once at the app root", () => {
  const layout = read("app/_layout.tsx");
  assert.match(layout, /<AccountSwitcherSheet \/>/);
  assert.match(layout, /rehydratePersistedStore\(['"]known accounts['"],\s*useKnownAccountsStore\)/);
});

test("login screen prefills the email passed from an expired switch", () => {
  const login = read("src/features/auth/screens/LoginScreen.tsx");
  assert.match(login, /useLocalSearchParams<\{ email\?: string \}>\(\)/);
  assert.match(login, /useState\(emailParam \?\? ['"]['"]\)/);
});

test("account switcher copy exists in both locales", () => {
  const zh = JSON.parse(read("src/i18n/locales/zh.json"));
  const en = JSON.parse(read("src/i18n/locales/en.json"));

  for (const dict of [zh, en]) {
    assert.ok(dict.accountSwitcher, "accountSwitcher block missing");
    assert.ok(dict.accountSwitcher.title);
    assert.ok(dict.accountSwitcher.addAccount);
    assert.ok(dict.accountSwitcher.current);
    assert.ok(dict.accountSwitcher.empty);
    assert.ok(dict.common.close);
  }
});
