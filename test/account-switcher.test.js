const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("known accounts store persists tokens under its own MMKV key via pure helpers", () => {
  const store = read("src/stores/knownAccountsStore.ts");

  assert.match(store, /name:\s*['"]circle-im-known-accounts['"]/);
  assert.match(store, /upsertKnownAccount/);
  assert.match(store, /removeKnownAccount/);
  // 持久化字段包含 token，支持免密快速切号
  assert.match(store, /partialize:\s*\(state\)\s*=>\s*\(\{\s*accounts:\s*state\.accounts\s*\}\)/);

  const logic = read("src/stores/knownAccountsLogic.ts");
  // 纯逻辑文件只能 import type，运行时不得拉入 MMKV/authStore
  assert.match(logic, /import type \{ AuthUser \}/);
  assert.doesNotMatch(logic, /from '@\/storage'/);
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

test("switch-to-account validates the session and falls back to login on expiry", () => {
  const useAuth = read("src/hooks/use-auth.ts");

  assert.match(useAuth, /switchToAccount/);
  // 拆旧会话 -> 激活存储 token -> 校验 /auth/me（401 自动续期）
  assert.match(useAuth, /await clearLocalSession\(\)/);
  assert.match(useAuth, /retry\(\(\) => fetchCurrentUser\(\)\)/);
  // 过期分支：移除死账号 + 跳登录页并预填账号
  assert.match(useAuth, /removeAccount\(account\.user\.id\)/);
  assert.match(
    useAuth,
    /pathname:\s*['"]\/\(auth\)\/login['"][\s\S]*accountId:\s*account\.user\.accountId/,
  );
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
  assert.match(layout, /useKnownAccountsStore\.persist\.rehydrate\(\)/);
});

test("login screen prefills the account id passed from an expired switch", () => {
  const login = read("src/features/auth/screens/LoginScreen.tsx");
  assert.match(login, /useLocalSearchParams<\{ accountId\?: string \}>\(\)/);
  assert.match(login, /useState\(accountId \?\? ['"]['"]\)/);
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
