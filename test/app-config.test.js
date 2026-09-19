const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const configPath = path.join(process.cwd(), 'app.config.js');
const appJson = require('../app.json');

function loadConfig(env = {}) {
  const previous = {
    APP_VARIANT: process.env.APP_VARIANT,
    EXPO_PUBLIC_EAS_PROJECT_ID: process.env.EXPO_PUBLIC_EAS_PROJECT_ID,
    GOOGLE_SERVICES_FILE: process.env.GOOGLE_SERVICES_FILE,
    EXPO_PUBLIC_PUSH_PROVIDER: process.env.EXPO_PUBLIC_PUSH_PROVIDER,
    EXPO_PUBLIC_JPUSH_APP_KEY: process.env.EXPO_PUBLIC_JPUSH_APP_KEY,
  };

  for (const key of Object.keys(previous)) {
    if (key in env) process.env[key] = env[key];
    else delete process.env[key];
  }

  try {
    delete require.cache[require.resolve(configPath)];
    return require(configPath)();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('dynamic app config preserves the static Expo config', () => {
  const config = loadConfig();

  assert.equal(config.name, appJson.expo.name);
  assert.equal(config.slug, appJson.expo.slug);
  assert.deepEqual(config.plugins.slice(0, appJson.expo.plugins.length), appJson.expo.plugins);
  assert.deepEqual(config.ios, appJson.expo.ios);
  assert.equal(config.android.package, appJson.expo.android.package);
});
test('dynamic app config maps optional push build environment values', () => {
  const config = loadConfig({
    EXPO_PUBLIC_EAS_PROJECT_ID: 'eas-project-id',
    GOOGLE_SERVICES_FILE: './secrets/google-services.json',
  });

  assert.equal(config.extra.eas.projectId, 'eas-project-id');
  assert.equal(
    config.android.googleServicesFile,
    './secrets/google-services.json',
  );
});

test('dynamic app config omits unset optional push build values', () => {
  const config = loadConfig();

  assert.equal(config.extra?.eas?.projectId, undefined);
  assert.equal(config.android.googleServicesFile, undefined);
});

test('preproduction is a separately installable Android app', () => {
  const config = loadConfig({ APP_VARIANT: 'preprod' });

  assert.equal(config.name, `${appJson.expo.name}测试版`);
  assert.equal(config.android.package, `${appJson.expo.android.package}.preprod`);
  assert.deepEqual(config.scheme, ['windnoteai-preprod', 'circleim-preprod']);
  assert.equal(config.extra.appVariant, 'preprod');
  assert.notEqual(config.android.package, appJson.expo.android.package);
});

test('preproduction JPush builds share the development APNs environment with runtime config', () => {
  const config = loadConfig({
    APP_VARIANT: 'preprod',
    EXPO_PUBLIC_PUSH_PROVIDER: 'jpush',
    EXPO_PUBLIC_JPUSH_APP_KEY: 'jpush-test-key',
  });

  assert.equal(config.extra.pushProvider, 'jpush');
  assert.equal(config.extra.jpushProduction, false);
  assert.deepEqual(config.plugins.at(-1), [
    './plugins/with-jpush',
    { appKey: 'jpush-test-key', channel: 'windnote', production: false },
  ]);
});

test('JPush provider builds fail closed without an app key', () => {
  assert.throws(
    () =>
      loadConfig({
        EXPO_PUBLIC_PUSH_PROVIDER: 'jpush',
      }),
    /EXPO_PUBLIC_PUSH_PROVIDER=jpush requires EXPO_PUBLIC_JPUSH_APP_KEY/,
  );
});

test('Expo builds still configure native JPush placeholders for autolinking', () => {
  const config = loadConfig();

  assert.deepEqual(config.plugins.at(-1), [
    './plugins/with-jpush',
    { appKey: '', channel: 'windnote', production: true },
  ]);
  assert.ok(config.android.permissions.includes('android.permission.POST_NOTIFICATIONS'));
});

test('dynamic app config rejects unknown push providers', () => {
  assert.throws(
    () => loadConfig({ EXPO_PUBLIC_PUSH_PROVIDER: 'jpus' }),
    /EXPO_PUBLIC_PUSH_PROVIDER must be expo or jpush/,
  );
});

test('production keeps the canonical identity and runtime update channel', () => {
  const config = loadConfig();

  assert.equal(config.name, appJson.expo.name);
  assert.equal(config.android.package, appJson.expo.android.package);
  assert.deepEqual(config.scheme, appJson.expo.scheme);
  assert.equal(config.extra.appVariant, 'production');
});

test('iOS 声明 audio 后台模式让通话在退后台后存活，且不带 voip (#118)', () => {
  const modes = appJson.expo.ios.infoPlist.UIBackgroundModes;
  assert.deepEqual(modes, ['audio']);
  // "voip" 只有配齐 PushKit + CallKit 才合法，裸声明是 App Review 拒审项。
  assert.ok(!modes.includes('voip'));
});

test('MMKV 目录在 iOS 上排除出设备备份 (#88)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const util = fs.readFileSync(
    path.join(process.cwd(), 'src/storage/ios-backup-exclusion.ts'),
    'utf8',
  );
  assert.match(util, /NSURLIsExcludedFromBackupKey: true/);
  assert.match(util, /DocumentDirectoryPath\}\/mmkv/);
  assert.match(util, /Platform\.OS !== 'ios'/);

  const layout = fs.readFileSync(
    path.join(process.cwd(), 'app/_layout.tsx'),
    'utf8',
  );
  assert.match(layout, /excludeMmkvDirFromIOSBackup\(\)/);
});

test('the JPush plugin gives an autolinked Android build its manifest placeholders even without an app key', async () => {
  // jpush-react-native / jcore-react-native 是无条件依赖,会被自动链接进每一个安卓
  // 构建;它们带进来的原生 SDK 清单要 JPUSH_APPKEY、APP_CHANNEL 两个占位符。原来
  // 只有配了 key 才注入,没配 key 的构建(预发布流水线就是)会在合并清单时失败。
  const withJPush = require('../plugins/with-jpush');
  const config = withJPush({ name: 'WindNote', slug: 'windnote' }, { appKey: '', channel: 'windnote' });
  const gradle = await config.mods.android.appBuildGradle({
    modRequest: {},
    modResults: {
      contents: 'android {\n    defaultConfig {\n        applicationId "com.example"\n    }\n}\n',
    },
  });

  assert.match(gradle.modResults.contents, /manifestPlaceholders\.JPUSH_APPKEY = ""/);
  // 极光原生 SDK(jcore 5.5 / jpush 6.2)清单里要的是 JPUSH_CHANNEL —— 厂商 RN 示例
  // 里的 APP_CHANNEL 不够:只设它,日常构建照样卡在 processReleaseMainManifest。
  assert.match(gradle.modResults.contents, /manifestPlaceholders\.JPUSH_CHANNEL = "windnote"/);
  assert.match(gradle.modResults.contents, /manifestPlaceholders\.APP_CHANNEL = "windnote"/);
  // 没有 key 就不是 JPush 构建:不声明远程推送后台模式,也不改 APNs 环境。
  assert.equal(config.mods.ios?.infoPlist, undefined);
  assert.equal(config.mods.ios?.entitlements, undefined);
});
