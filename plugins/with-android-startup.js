const fs = require('node:fs/promises');
const path = require('node:path');
const { AndroidConfig, withAndroidColors, withAndroidColorsNight, withAndroidStyles, withDangerousMod, withMainActivity } = require('expo/config-plugins');
const { mergeContents, removeGeneratedContents } = require('@expo/config-plugins/build/utils/generateCode');

// Android still needs a starting window. Keep it plain and remove it without a fade.
module.exports = function withAndroidStartup(config) {
  config = withAndroidColors(config, mod => {
    mod.modResults = AndroidConfig.Colors.assignColorValue(mod.modResults, { name: 'splashscreen_background', value: '#F8F9FA' });
    return mod;
  });
  config = withAndroidColorsNight(config, mod => {
    mod.modResults = AndroidConfig.Colors.assignColorValue(mod.modResults, { name: 'splashscreen_background', value: '#000000' });
    return mod;
  });
  config = withAndroidStyles(config, mod => {
    mod.modResults = AndroidConfig.Styles.assignStylesValue(mod.modResults, {
      add: true, parent: { name: 'AppTheme' }, name: 'android:windowBackground', value: '@color/splashscreen_background',
    });
    mod.modResults.resources.style = [
      ...mod.modResults.resources.style.filter(style => style.$.name !== 'Theme.App.SplashScreen'),
      {
        $: { name: 'Theme.App.SplashScreen', parent: 'AppTheme' },
        item: Object.entries({
          'android:windowBackground': '@color/splashscreen_background',
          'android:windowSplashScreenBackground': '@color/splashscreen_background',
          'android:windowSplashScreenAnimatedIcon': '@android:color/transparent',
          'android:windowSplashScreenBrandingImage': '@android:color/transparent',
          'android:windowSplashScreenAnimationDuration': '0',
        }).map(([name, value]) => ({ $: { name }, _: value })),
      },
    ];
    return mod;
  });
  config = withMainActivity(config, mod => {
    let source = removeGeneratedContents(mod.modResults.contents, 'expo-splashscreen') ?? mod.modResults.contents;
    source = source
      .replace(/^import expo\.modules\.splashscreen\.SplashScreenManager;?\r?\n/gm, '')
      .replace(/^[ \t]*SplashScreenManager\.registerOnActivity\(this\);?\r?\n/gm, '')
      .replace(/^[ \t]*\/\/ This is required for expo-splash-screen\.\r?\n/gm, '')
      .replace(/\/\/ setTheme\(R\.style\.AppTheme\);?/, 'setTheme(R.style.AppTheme)');
    mod.modResults.contents = mergeContents({
      src: source,
      tag: 'windnote-no-splash-animation',
      anchor: /super\.onCreate\(null\)/,
      offset: 1,
      comment: '    //',
      newSrc: '    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {\n      splashScreen.setOnExitAnimationListener { it.remove() }\n    }',
    }).contents;
    return mod;
  });
  return withDangerousMod(config, ['android', async mod => {
    const res = path.join(mod.modRequest.projectRoot, 'android/app/src/main/res');
    const entries = await fs.readdir(res, { withFileTypes: true });
    for (const entry of entries.filter(entry => entry.isDirectory() && /^drawable(?:-|$)/.test(entry.name))) {
      for (const name of ['splashscreen_logo.png', 'splashscreen_logo.xml', 'splashscreen_logo.webp']) {
        await fs.rm(path.join(res, entry.name, name), { force: true });
      }
    }
    // This legacy drawable contained the old splash bitmap; launcher icons use mipmap resources.
    await fs.rm(path.join(res, 'drawable/ic_launcher_background.xml'), { force: true });
    return mod;
  }]);
};
