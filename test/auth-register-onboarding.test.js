const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

test('registration authenticates with returned tokens and starts onboarding', () => {
  const source = read('src/hooks/use-auth.ts');

  assert.match(source, /const tokens = await registerRequest\(/);
  assert.match(source, /await onAuthSuccess\(tokens,\s*\{[\s\S]*onboardingRequired:\s*true/);
  assert.match(source, /startAppServices:\s*false/);
  assert.doesNotMatch(source, /redirectHref:/);
  assert.match(source, /if \(options\.startAppServices !== false\)/);
  assert.doesNotMatch(source, /pathname:\s*['"]\/\(auth\)\/login['"][\s\S]*email:\s*normalizedEmail/);
});

test('auth store persists the onboarding-required session flag', () => {
  const source = read('src/stores/authStore.ts');

  assert.match(source, /onboardingRequired:\s*boolean/);
  assert.match(source, /setOnboardingRequired/);
  assert.match(source, /onboardingRequired:\s*options\?\.onboardingRequired\s*\?\?\s*false/);
  assert.match(source, /onboardingRequired:\s*state\.onboardingRequired/);
  assert.match(source, /clearSession:[\s\S]*onboardingRequired:\s*false/);
});

test('onboarding route and screen save profile then enter the app', () => {
  const route = read('app/(onboarding)/profile.tsx');
  const layout = read('app/(onboarding)/_layout.tsx');
  const screen = read('src/features/auth/screens/OnboardingProfileScreen.tsx');
  const rootLayout = read('app/_layout.tsx');

  assert.match(route, /OnboardingProfileScreen/);
  assert.match(layout, /Stack/);
  assert.match(rootLayout, /<Stack\.Screen name="\(onboarding\)" \/>/);
  assert.match(screen, /updateUserProfile/);
  assert.match(screen, /requestUploadPresign/);
  assert.match(screen, /uploadLocalFileToPresignedUrl/);
  assert.doesNotMatch(screen, /const \[birthday, setBirthday\]/);
  assert.doesNotMatch(screen, /toProfileUpdatePayload\('birthday'/);
  assert.doesNotMatch(screen, /profileFields\.birthday/);
  assert.match(screen, /useKnownAccountsStore/);
  assert.match(screen, /upsertAccount\(\{[\s\S]*user:\s*nextUser/);
  assert.match(screen, /setOnboardingRequired\(false\)/);
  // Navigate straight to the final destination, exactly like login's onAuthSuccess
  // (router.replace('/(tabs)/messages')). It must NOT go through '/' (index): the
  // index-hop redirect target diverges from the AuthRouteGuard's own
  // <Redirect href="/(tabs)/messages"> that fires the same frame onboardingRequired
  // clears, and the two competing navigations intermittently wedged expo-router and
  // stranded the user on onboarding (store was already correct, so a reload recovered).
  assert.match(screen, /router\.replace\('\/\(tabs\)\/messages'\)/);
  assert.doesNotMatch(screen, /router\.replace\('\/'\)/);
  assert.doesNotMatch(screen, /<Redirect href="\/" \/>/);
  assert.match(screen, /loginToOpenIM/);
  assert.match(screen, /useMessageGroupsStore\.getState\(\)\.load\(\)/);
  assert.ok(
    screen.indexOf('setOnboardingRequired(false)') <
      screen.indexOf("router.replace('/(tabs)/messages')"),
    'onboarding flag must be cleared before navigating into the app',
  );
  assert.ok(
    screen.indexOf("router.replace('/(tabs)/messages')") <
      screen.indexOf('startAppServicesAfterOnboarding(nextUser.id, imToken ?? null)'),
    'profile save must leave onboarding before starting app services',
  );
  assert.ok(
    screen.indexOf('startAppServicesAfterOnboarding') <
      screen.indexOf('useMessageGroupsStore.getState().load()'),
    'app data load must stay inside the deferred onboarding service starter',
  );
});

test('onboarding profile city is selected from the city picker instead of typed', () => {
  const screen = read('src/features/auth/screens/OnboardingProfileScreen.tsx');

  // The screen delegates the province/city picker to the CityPickerSheet
  // component rather than embedding the modal inline.
  assert.match(screen, /CityPickerSheet/);
  assert.match(screen, /handleConfirmCity/);
  assert.doesNotMatch(screen, /onChangeText=\{setCity\}/);
  assert.doesNotMatch(screen, /maxLength=\{30\}/);

  // The picker logic itself lives in the extracted component.
  const sheet = read('src/features/auth/components/CityPickerSheet.tsx');
  assert.match(sheet, /BottomSheetModal/);
  assert.match(sheet, /CITY_PROVINCES/);
  assert.match(sheet, /findProvinceByCity/);
});

test('onboarding city picker sheet uses a taller flexible layout', () => {
  const sheet = read('src/features/auth/components/CityPickerSheet.tsx');

  assert.match(sheet, /modalCard:\s*\{[\s\S]*height:\s*'82%'/);
  assert.match(sheet, /modalHeader:\s*\{[\s\S]*marginBottom:\s*Spacing\.sm/);
  assert.match(sheet, /pickerColumns:\s*\{[\s\S]*flex:\s*1/);
  assert.match(sheet, /pickerList:\s*\{[\s\S]*flex:\s*1/);
  assert.doesNotMatch(sheet, /maxHeight:\s*'70%'/);
  assert.doesNotMatch(sheet, /maxHeight:\s*260/);
});

test('root index respects onboarding-required sessions', () => {
  const index = read('app/index.tsx');

  assert.match(index, /onboardingRequired/);
  assert.match(index, /if \(isAuthenticated && onboardingRequired\)/);
  assert.match(index, /<Redirect href="\/\(onboarding\)\/profile" \/>/);
});

test('session bootstrap reconciles stale onboarding state before starting app services', () => {
  const source = read('src/components/app/session-bootstrap.tsx');

  assert.match(source, /const onboardingRequired = useAuthStore/);
  assert.match(source, /hasCompletedOnboardingProfile/);
  assert.match(source, /if \(!hasHydrated \|\| onboardingRequired\)/);
  assert.match(source, /if \(!hasHydrated \|\| !isLoading\)/);
  assert.match(
    source,
    /if \(onboardingRequired && !hasCompletedOnboardingProfile\(user\)\) \{[\s\S]*return;/,
  );
  assert.match(source, /if \(onboardingRequired\) \{[\s\S]*setOnboardingRequired\(false\)/);
  assert.ok(
    source.indexOf('onboardingRequired') < source.indexOf('connectRealtime(accessToken)'),
    'realtime connect must be gated by onboardingRequired',
  );
  assert.ok(
    source.indexOf('hasCompletedOnboardingProfile(user)') <
      source.indexOf('ensureOpenIMLogin(user.id, imToken)'),
    'OpenIM bootstrap login must wait until onboarding profile is complete',
  );
  assert.ok(
    source.indexOf('hasCompletedOnboardingProfile(user)') <
      source.indexOf('useMessageGroupsStore.getState().load()'),
    'conversation groups load must wait until onboarding profile is complete',
  );
  // /auth/me 瞬时失败后的降级补登走 recoverOpenIMLogin，它绕开了上面那道门禁，
  // 必须自带一道等价的 —— 否则 onboarding 未完成的用户会被补登进 IM。
  assert.match(
    source,
    /if \(onboardingPending \|\| !cachedUser \|\| !cachedImToken\) \{\s*return;/,
  );
  // 且补登只能读快照：拿一份可能过期的 user 回写路由输入，正是「onboarding 被弹回」的老根因。
  const recoverBody = source.slice(
    source.indexOf('const recoverOpenIMLogin'),
    source.indexOf('useEffect(() => {', source.indexOf('const recoverOpenIMLogin')),
  );
  assert.ok(recoverBody.length > 0, 'recoverOpenIMLogin must exist');
  assert.doesNotMatch(recoverBody, /setOnboardingRequired\(/);
  assert.doesNotMatch(recoverBody, /setUser\(/);
});

test('root layout waits for persisted auth hydration before rendering routes', () => {
  const layout = read('app/_layout.tsx');

  assert.match(layout, /async function rehydratePersistedStore/);
  assert.match(layout, /await Promise\.all\(\[/);
  assert.match(layout, /rehydratePersistedStore\('auth', useAuthStore\)/);
  assert.match(layout, /setMigrated\(true\)/);
  assert.ok(
    layout.indexOf('await Promise.all([') < layout.indexOf('setMigrated(true)'),
    'setMigrated(true) must happen after persisted stores finish rehydrating',
  );
});
