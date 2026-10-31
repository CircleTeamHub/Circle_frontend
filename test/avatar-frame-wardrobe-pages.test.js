const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (relativePath) =>
  fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

const LOCALES = ['zh', 'en', 'ja', 'ko', 'es'];

// 「我的装扮」中转页已取消:它只剩「徽章」一行(头像框在功能开关后面),
// 资料卡上的入口改名「徽章」并直达徽章页。
test('profile member card opens the badge page directly from both entry points', () => {
  const source = read('src/features/profile/screens/ProfileScreen.tsx');
  const memberCard =
    source.match(/\{\/\* Member card \*\/\}[\s\S]*?(?=\n  return \()/)?.[0] ?? '';

  assert.match(source, /router\.push\(['"]\/\(tabs\)\/profile\/icons['"]/);
  assert.match(memberCard, /profile\.badges/);
  assert.match(memberCard, /onPress=\{handleOpenBadges\}/);
  assert.equal(
    (memberCard.match(/accessibilityRole="button"/g) ?? []).length >= 4,
    true,
  );
  assert.equal(
    (memberCard.match(/accessibilityLabel=\{t\('profile\.badges'/g) ?? []).length,
    2,
  );
  assert.equal(
    (memberCard.match(/accessibilityHint=\{t\('profile\.badgesHint'/g) ?? []).length,
    2,
  );
});

test('the decorations hub page is gone and nothing links to it', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  for (const rel of [
    'app/(tabs)/profile/decorations.tsx',
    'src/features/profile/screens/MyDecorationsScreen.tsx',
  ]) {
    assert.equal(fs.existsSync(path.join(process.cwd(), rel)), false, `${rel} should be removed`);
  }
  for (const rel of [
    'src/features/profile/screens/ProfileScreen.tsx',
    'src/features/profile/screens/MyIconsScreen.tsx',
    'src/features/profile/screens/AvatarFramesScreen.tsx',
  ]) {
    assert.doesNotMatch(read(rel), /\/\(tabs\)\/profile\/decorations/, rel);
  }
});

test('avatar-frame collection route renders wardrobe states, preview, and detail navigation', () => {
  const route = read('app/(tabs)/profile/avatar-frames.tsx');
  const screen = read(
    'src/features/profile/screens/AvatarFramesScreen.tsx',
  );

  assert.match(route, /AvatarFramesScreen/);
  assert.match(screen, /fetchAvatarFrameInventory/);
  assert.match(screen, /getAvatarFrameSource/);
  assert.match(screen, /<NavHeader/);
  assert.match(screen, /<FlatList/);
  assert.match(screen, /contentInsetAdjustmentBehavior="automatic"/);
  assert.match(screen, /ListHeaderComponent=/);
  assert.match(screen, /ListEmptyComponent=/);
  assert.match(screen, /renderItem=\{renderWardrobeItem\}/);
  assert.doesNotMatch(screen, /<ScrollView/);
  assert.doesNotMatch(screen, /inventory\.items\.map/);
  assert.match(screen, /ActivityIndicator/);
  assert.match(screen, /avatarFrames\.loadError/);
  assert.match(screen, /avatarFrames\.retry/);
  assert.match(screen, /avatarFrames\.empty/);
  assert.match(screen, /avatarFrames\.none/);
  assert.match(screen, /availableUntil/);
  assert.match(screen, /ownedSources/);
  assert.match(screen, /avatarFrames\.noSources/);
  assert.match(screen, /equippedFrameId/);
  assert.match(
    screen,
    /pathname:\s*['"]\/\(tabs\)\/profile\/avatar-frame\/\[id\]['"]/,
  );
  assert.match(screen, /openDetail\(null\)/);
  assert.doesNotMatch(screen, /Dimensions/);
});

test('avatar-frame detail route supports none, unowned IDs, and guarded server-authoritative equip', () => {
  const route = read('app/(tabs)/profile/avatar-frame/[id].tsx');
  const screen = read(
    'src/features/profile/screens/AvatarFrameDetailScreen.tsx',
  );

  assert.match(route, /AvatarFrameDetailScreen/);
  assert.match(screen, /useLocalSearchParams/);
  assert.match(screen, /fetchAvatarFrameInventory/);
  assert.match(screen, /equipAvatarFrame/);
  assert.match(screen, /getAvatarFrameSource/);
  assert.match(screen, /<NavHeader/);
  assert.match(screen, /contentInsetAdjustmentBehavior="automatic"/);
  assert.match(screen, /unequipped === ['"]1['"]/);
  assert.match(screen, /avatarFrames\.notFound/);
  assert.match(screen, /pendingRef\.current/);
  assert.match(screen, /disabled=\{submitting/);
  assert.match(screen, /avatarFrames\.saveError/);
  assert.match(screen, /setInventory\(nextInventory\)/);
  assert.match(screen, /avatarFrameAppearance/);
  assert.match(screen, /captureAuthSessionIdentity/);
  assert.match(screen, /isAuthSessionIdentityCurrent/);
  assert.match(screen, /authState\.setUser/);
  assert.match(screen, /reconcileUserAppearance/);
  assert.doesNotMatch(screen, /useUserAppearanceStore\.setState/);
  assert.doesNotMatch(screen, /Dimensions/);
});

test('mall routes the avatar-frame product into the wardrobe', () => {
  const screen = read('src/features/profile/screens/MallScreen.tsx');

  assert.match(screen, /product\.action === ['"]avatar-frame['"]/);
  assert.match(
    screen,
    /router\.push\(['"]\/\(tabs\)\/profile\/avatar-frames['"]/,
  );
});

test('avatar-frame pages expose complete detail content and localize all five locales with parity', () => {
  const collection = read(
    'src/features/profile/screens/AvatarFramesScreen.tsx',
  );
  const detail = read(
    'src/features/profile/screens/AvatarFrameDetailScreen.tsx',
  );

  for (const key of [
    'description',
    'sources',
    'expires',
    'permanent',
    'equipped',
    'equip',
    'remove',
  ]) {
    assert.match(detail, new RegExp(`avatarFrames\\.${key}`));
  }
  assert.match(collection, /avatarFrames\.source\.membership/);
  assert.match(collection, /avatarFrames\.source\.admin/);
  assert.match(detail, /avatarFrames\.source\.membership/);
  assert.match(detail, /avatarFrames\.source\.admin/);

  const locales = Object.fromEntries(
    LOCALES.map((locale) => [
      locale,
      JSON.parse(read(`src/i18n/locales/${locale}.json`)),
    ]),
  );
  const referenceKeys = Object.keys(locales.zh.profile.avatarFrames).sort();
  for (const locale of LOCALES) {
    // 资料卡入口改名「徽章」后,文案在 profile.badges / profile.badgesHint。
    for (const key of ['badges', 'badgesHint']) {
      assert.equal(
        locales[locale].profile[key].length > 0,
        true,
        `${locale}.profile.${key}`,
      );
    }
    assert.deepEqual(
      Object.keys(locales[locale].profile.avatarFrames).sort(),
      referenceKeys,
      `${locale}.profile.avatarFrames parity`,
    );
    assert.deepEqual(
      Object.keys(locales[locale].profile.avatarFrames.source).sort(),
      Object.keys(locales.zh.profile.avatarFrames.source).sort(),
      `${locale}.profile.avatarFrames.source parity`,
    );
  }
});
