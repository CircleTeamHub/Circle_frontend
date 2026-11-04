const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('native starting theme has no branded icon or animation', () => {
  const result = spawnSync(process.execPath, [require.resolve('expo/bin/cli'), 'config', '--type', 'introspect', '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const android = JSON.parse(result.stdout)._internal.modResults.android;
  const theme = android.styles.resources.style.find(style => style.$.name === 'Theme.App.SplashScreen');
  assert.equal(theme.$.parent, 'AppTheme');
  const items = Object.fromEntries(theme.item.map(item => [item.$.name, item._]));
  assert.equal(items['android:windowSplashScreenAnimatedIcon'], '@android:color/transparent');
  assert.equal(items['android:windowSplashScreenBrandingImage'], '@android:color/transparent');
  assert.equal(items['android:windowSplashScreenAnimationDuration'], '0');
  assert.equal(items['android:windowBackground'], '@color/splashscreen_background');
  assert.equal(items.windowSplashScreenAnimatedIcon, undefined);
  assert.equal(items['android:windowSplashScreenBehavior'], undefined);
  assert.equal(android.colors.resources.color.find(color => color.$.name === 'splashscreen_background')._, '#F8F9FA');
  assert.equal(android.colorsNight.resources.color.find(color => color.$.name === 'splashscreen_background')._, '#000000');
});

test('native startup removes Expo registration and exits immediately without duplicating code', async () => {
  const plugin = require('../plugins/with-android-startup');
  const config = plugin({ name: 'startup-test', slug: 'startup-test' });
  const contents = `package example
import expo.modules.splashscreen.SplashScreenManager
import android.os.Build
class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // setTheme(R.style.AppTheme);
    // @generated begin expo-splashscreen - expo prebuild
    SplashScreenManager.registerOnActivity(this)
    // @generated end expo-splashscreen
    super.onCreate(null)
  }
  override fun invokeDefaultOnBackPressed() { super.invokeDefaultOnBackPressed() }
}
`;
  const run = source => config.mods.android.mainActivity({ ...config, modResults: { language: 'kt', contents: source }, modRequest: { platform: 'android', modName: 'mainActivity' } });
  const first = (await run(contents)).modResults.contents;
  assert.doesNotMatch(first, /SplashScreenManager|registerOnActivity/);
  assert.doesNotMatch(first, /@generated (?:begin|end) expo-splashscreen/);
  assert.match(first, /setTheme\(R\.style\.AppTheme\)/);
  assert.match(first, /Build\.VERSION\.SDK_INT >= Build\.VERSION_CODES\.S/);
  assert.match(first, /splashScreen\.setOnExitAnimationListener\s*\{\s*it\.remove\(\)\s*\}/);
  assert.match(first, /override fun invokeDefaultOnBackPressed/);
  assert.equal((first.match(/super\.onCreate\(null\)/g) || []).length, 1);
  assert.equal((await run(first)).modResults.contents, first);
  const untagged = (await run(contents.replace(/^.*@generated.*\n/gm, ''))).modResults.contents;
  assert.doesNotMatch(untagged, /SplashScreenManager|registerOnActivity/);
});

test('prebuild clears stale launch artwork while preserving launcher icons and other drawables', async () => {
  const plugin = require('../plugins/with-android-startup');
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'windnote-startup-'));
  const res = path.join(projectRoot, 'android/app/src/main/res');
  const stale = ['drawable-mdpi/splashscreen_logo.png', 'drawable-xxxhdpi/splashscreen_logo.png', 'drawable-night-xhdpi/splashscreen_logo.png', 'drawable/splashscreen_logo.xml', 'drawable-night/splashscreen_logo.xml', 'drawable/ic_launcher_background.xml'];
  const preserved = ['mipmap-anydpi-v26/ic_launcher.xml', 'mipmap-hdpi/ic_launcher_background.webp', 'drawable/chat_background.png'];
  try {
    for (const file of [...stale, ...preserved]) {
      await fs.mkdir(path.dirname(path.join(res, file)), { recursive: true });
      await fs.writeFile(path.join(res, file), 'fixture');
    }
    const config = plugin({ name: 'startup-test', slug: 'startup-test' });
    const run = () => config.mods.android.dangerous({ ...config, modResults: {}, modRequest: { projectRoot, platform: 'android', modName: 'dangerous' } });
    await run();
    await run();
    for (const file of stale) await assert.rejects(fs.access(path.join(res, file)), { code: 'ENOENT' });
    for (const file of preserved) assert.equal(await fs.readFile(path.join(res, file), 'utf8'), 'fixture');
  } finally {
    assert.equal(path.dirname(projectRoot), path.resolve(os.tmpdir()));
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});
