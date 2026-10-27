const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const withCallPush = require('../plugins/with-call-push');
const {
  addVoipBackgroundMode,
  removeVoipBackgroundMode,
  replaceJPushReceiver,
} = withCallPush;

const JPUSH_RECEIVER = 'cn.jiguang.plugins.push.receiver.JPushModuleReceiver';
const CALL_RECEIVER = 'expo.modules.callpush.CallJPushReceiver';

function manifest(receivers = []) {
  return {
    manifest: {
      $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
      application: [{ $: { 'android:name': '.MainApplication' }, receiver: receivers }],
    },
  };
}

test('removes the JPush receiver from the app manifest so the call-aware subclass takes over', () => {
  const result = replaceJPushReceiver(
    manifest([
      { $: { 'android:name': 'some.other.Receiver' } },
      // 早期版本写进 App 清单的声明：要清掉。
      { $: { 'android:name': CALL_RECEIVER } },
    ]),
  );
  const receivers = result.manifest.application[0].receiver;

  assert.equal(result.manifest.$['xmlns:tools'], 'http://schemas.android.com/tools');
  // tools:node=remove 写在 App 清单里才压得过库清单。
  assert.deepEqual(receivers, [
    { $: { 'android:name': 'some.other.Receiver' } },
    { $: { 'android:name': JPUSH_RECEIVER, 'tools:node': 'remove' } },
  ]);
});

test('the call-aware receiver is declared in the library manifest, not the app manifest', () => {
  // 写进 App 清单会被 lintVitalRelease 拦下（Instantiatable：父类链上的极光 SDK 不在
  // App 的编译类路径上）。库清单里的组件不在 App lint 的检查范围内。
  const libraryManifest = fs.readFileSync(
    path.join(process.cwd(), 'modules/call-push/android/src/main/AndroidManifest.xml'),
    'utf8',
  );
  assert.match(
    libraryManifest,
    /<receiver\s+android:name="\.CallJPushReceiver"[^>]*android:exported="false">\s*<intent-filter>\s*<action android:name="cn\.jpush\.android\.intent\.RECEIVER_MESSAGE" \/>\s*<category android:name="\$\{applicationId\}" \/>/,
  );
});

test('is idempotent across repeated prebuilds', () => {
  const once = replaceJPushReceiver(manifest());
  const twice = replaceJPushReceiver(once);
  const names = twice.manifest.application[0].receiver.map((r) => r.$['android:name']);

  assert.deepEqual(names, [JPUSH_RECEIVER]);
});

test('adds the voip background mode without dropping existing modes', () => {
  assert.deepEqual(
    addVoipBackgroundMode({ UIBackgroundModes: ['audio', 'remote-notification'] }).UIBackgroundModes,
    ['audio', 'remote-notification', 'voip'],
  );
  assert.deepEqual(addVoipBackgroundMode({}).UIBackgroundModes, ['voip']);
  assert.deepEqual(
    addVoipBackgroundMode({ UIBackgroundModes: ['voip'] }).UIBackgroundModes,
    ['voip'],
  );
});

function loadAppConfig(env) {
  const configPath = path.join(process.cwd(), 'app.config.js');
  const saved = {};
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  try {
    delete require.cache[require.resolve(configPath)];
    return require(configPath)();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function pluginEntry(config, name) {
  return config.plugins.find((plugin) =>
    Array.isArray(plugin) ? plugin[0] === name : plugin === name,
  );
}

test('the app config defaults iOS calls to CallKit and bundles no ringtone', () => {
  const config = loadAppConfig({
    EXPO_PUBLIC_IOS_CALL_MODE: undefined,
    EXPO_PUBLIC_JPUSH_APP_KEY: undefined,
    EXPO_PUBLIC_PUSH_PROVIDER: undefined,
  });

  assert.deepEqual(pluginEntry(config, './plugins/with-call-push'), [
    './plugins/with-call-push',
    { iosMode: 'callkit' },
  ]);
  assert.equal(config.extra.iosCallMode, 'callkit');
  assert.equal(pluginEntry(config, 'expo-notifications'), 'expo-notifications');
});

test('a China App Store build switches to time-sensitive notifications at build time', () => {
  const config = loadAppConfig({
    EXPO_PUBLIC_IOS_CALL_MODE: 'notification',
    EXPO_PUBLIC_JPUSH_APP_KEY: 'jpush-key',
    EXPO_PUBLIC_PUSH_PROVIDER: undefined,
  });

  assert.deepEqual(pluginEntry(config, './plugins/with-call-push'), [
    './plugins/with-call-push',
    { iosMode: 'notification' },
  ]);
  assert.equal(config.extra.iosCallMode, 'notification');
  // APNs 的 sound 只能引用包内文件：铃声要进包。
  assert.deepEqual(pluginEntry(config, 'expo-notifications'), [
    'expo-notifications',
    { sounds: ['./assets/sounds/call_ring.caf'] },
  ]);
  assert.ok(fs.existsSync(path.join(process.cwd(), 'assets/sounds/call_ring.caf')));
});

test('the build-time switch rejects unknown modes and notification mode without JPush', () => {
  assert.throws(
    () => loadAppConfig({ EXPO_PUBLIC_IOS_CALL_MODE: 'region', EXPO_PUBLIC_JPUSH_APP_KEY: 'k' }),
    /EXPO_PUBLIC_IOS_CALL_MODE must be callkit or notification/,
  );
  assert.throws(
    () =>
      loadAppConfig({
        EXPO_PUBLIC_IOS_CALL_MODE: 'notification',
        EXPO_PUBLIC_JPUSH_APP_KEY: undefined,
        EXPO_PUBLIC_PUSH_PROVIDER: undefined,
      }),
    /requires EXPO_PUBLIC_JPUSH_APP_KEY/,
  );
});

test('removes the voip background mode for notification-mode builds', () => {
  assert.deepEqual(
    removeVoipBackgroundMode({ UIBackgroundModes: ['audio', 'voip'] }).UIBackgroundModes,
    ['audio'],
  );
});

test('the pod compiles CallKit out when the build-time switch says notification', () => {
  const podspec = fs.readFileSync(
    path.join(process.cwd(), 'modules/call-push/ios/CallPush.podspec'),
    'utf8',
  );
  assert.match(podspec, /podfile_properties\['callPush\.iosMode'\] == 'notification'/);
  assert.match(podspec, /CALL_PUSH_NO_CALLKIT/);
  const center = fs.readFileSync(
    path.join(process.cwd(), 'modules/call-push/ios/CallPushCenter.swift'),
    'utf8',
  );
  // CallKit 实现整份包在条件编译里：通知模式的二进制里不能出现 CallKit。
  assert.match(center, /^#if !CALL_PUSH_NO_CALLKIT\nimport AVFAudio\nimport CallKit/m);
  assert.match(center, /#endif\s*$/);
});

test('the native receiver keeps the class name the plugin registers', () => {
  const source = fs.readFileSync(
    path.join(
      process.cwd(),
      'modules/call-push/android/src/main/java/expo/modules/callpush/CallPushReceivers.kt',
    ),
    'utf8',
  );
  assert.match(source, /^package expo\.modules\.callpush$/m);
  assert.match(source, /class CallJPushReceiver : JPushModuleReceiver\(\)/);
  // 非来电消息必须原样交回 jpush-react-native，现有的 JS 监听才不受影响。
  assert.match(source, /super\.onMessage\(context, customMessage\)/);
});
