const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relativePath) =>
  fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

test('Android update installation is configured and mounted at the app root', () => {
  const pkg = JSON.parse(read('package.json'));
  const app = JSON.parse(read('app.json')).expo;
  const layout = read('app/_layout.tsx');

  assert.match(pkg.dependencies['expo-intent-launcher'], /^~/);
  assert.ok(app.android.permissions.includes('android.permission.REQUEST_INSTALL_PACKAGES'));
  assert.match(layout, /AppUpdateHost/);
});

test('update service uses a bounded no-store check and the Android package installer', () => {
  const source = read('src/features/app-update/app-update-service.ts');

  assert.match(source, /dependencies\.platform !== 'android'/);
  assert.match(source, /dependencies\.appVariant === 'preprod'/);
  assert.match(
    source,
    /CircleTeamHub\/windnote-releases\/releases\/latest\/download\/release\.json/,
  );
  assert.match(source, /cache:\s*'no-store'/);
  assert.match(source, /AbortController/);
  assert.match(source, /10_000/);
  assert.match(source, /expo-file-system\/legacy/);
  assert.match(source, /getContentUriAsync/);
  assert.match(source, /android\.intent\.action\.VIEW/);
  assert.match(source, /application\/vnd\.android\.package-archive/);
});

test('version screen performs a guarded manual update check', () => {
  const screen = read('src/features/profile/screens/AboutVersionScreen.tsx');
  const article = read(
    'src/features/profile/screens/about-article-screen.tsx',
  );

  assert.match(screen, /checkForAndroidUpdate/);
  assert.match(screen, /downloadAndInstallAndroidUpdate/);
  assert.match(screen, /checkingRef/);
  assert.match(screen, /installingRef/);
  assert.match(screen, /mountedRef/);
  assert.match(screen, /Pressable/);
  assert.match(screen, /appUpdate\.checkNow/);
  assert.match(article, /footer\?:\s*React\.ReactNode/);
});

test('every locale defines the complete app update copy', () => {
  const requiredKeys = [
    'availableTitle',
    'availableMessage',
    'updateNow',
    'checkNow',
    'checking',
    'latestTitle',
    'latestMessage',
    'checkFailedTitle',
    'checkFailedMessage',
    'installFailedTitle',
    'installFailedMessage',
    'androidOnlyMessage',
  ];

  for (const locale of ['zh', 'en', 'ja', 'ko', 'es']) {
    const messages = JSON.parse(read(`src/i18n/locales/${locale}.json`));
    const missing = requiredKeys.filter((key) => !messages.appUpdate?.[key]);
    assert.deepEqual(missing, [], `${locale} appUpdate missing: ${missing.join(', ')}`);
  }
});
