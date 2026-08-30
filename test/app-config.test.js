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
  assert.deepEqual(config.plugins, appJson.expo.plugins);
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
