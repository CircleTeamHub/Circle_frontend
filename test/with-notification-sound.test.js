const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('notification channels are installed before native startup and migration is idempotent', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'plugins/with-notification-sound.js'), 'utf8');
  let apply;
  const context = { module: { exports: {} }, require: (id) => {
    if (id === 'expo/config-plugins') return { withMainApplication: (config, callback) => { apply = callback; return config; } };
    return require(id);
  } };
  vm.runInNewContext(source, context);
  context.module.exports({ name: 'WindNote' });
  const input = { modResults: { language: 'kt', contents: 'class MainApplication {\n  override fun onCreate() {\n    super.onCreate()\n    loadReactNative(this)\n  }\n}\n' } };
  const once = apply(input).modResults.contents;
  const twice = apply(input).modResults.contents;
  assert.equal(twice, once);
  assert.ok(once.indexOf('createNotificationChannel') < once.indexOf('loadReactNative'));
  assert.match(once, /chat_swift_gesture/);
  assert.match(once, /activity_swift_gesture/);
  assert.match(once, /R\.raw\.notification_swift_gesture/);
  assert.match(once, /getNotificationChannel\(channelId\) == null/);
  assert.match(once, /legacy\?\.importance/);
  assert.match(once, /legacy\.sound != android\.provider\.Settings\.System\.DEFAULT_NOTIFICATION_URI/);
  assert.match(once, /legacy\.sound/);
  assert.doesNotMatch(once, /deleteNotificationChannel/);
  assert.match(once, /"chat_swift_gesture" to "chat"/);
  assert.match(once, /"activity_swift_gesture" to "expo_notifications_fallback_notification_channel"/);
  context.module.exports({}, { pushProvider: 'jpush' });
  const jpush = apply({ modResults: { language: 'kt', contents: 'class MainApplication {\n  override fun onCreate() {\n    super.onCreate()\n  }\n}\n' } }).modResults.contents;
  assert.match(jpush, /"chat_swift_gesture" to "JPush_3_7"/);
  assert.match(jpush, /"activity_swift_gesture" to "JPush_3_7"/);
  assert.match(jpush, /legacy\?\.importance/);
  assert.match(jpush, /legacy\.sound != android\.provider\.Settings\.System\.DEFAULT_NOTIFICATION_URI/);
  assert.doesNotMatch(jpush, /incoming_call_v1|deleteNotificationChannel/);
});

test('offline notification sound is a bundled short PCM WAV with a valid Android resource name', () => {
  const sound = fs.readFileSync('assets/sounds/notification_swift_gesture.wav');
  assert.equal(sound.toString('ascii', 0, 4), 'RIFF');
  assert.equal(sound.toString('ascii', 8, 12), 'WAVE');
  const config = require('../app.config')();
  const plugin = config.plugins.find((entry) => Array.isArray(entry) && entry[0] === 'expo-notifications');
  assert.ok(plugin[1].sounds.includes('./assets/sounds/notification_swift_gesture.wav'));
  assert.equal(plugin[1].defaultChannel, 'activity_swift_gesture');
  const soundPlugin = config.plugins.find((entry) => Array.isArray(entry) && entry[0] === './plugins/with-notification-sound');
  assert.equal(soundPlugin[1].pushProvider, config.extra.pushProvider);
});

const backendPath = path.join(process.env.CIRCLE_BE_PATH ?? path.join(process.cwd(), '..', 'circle_be'), 'src/notification/notification-push.service.ts');
test('the backend names the sound and default channel bundled by the native client', {
  skip: !fs.existsSync(backendPath) && 'backend not checked out beside the app',
}, () => {
  const backend = fs.readFileSync(backendPath, 'utf8');
  const sound = backend.match(/export const NOTIFICATION_PUSH_SOUND = '([^']+)'/)?.[1];
  const channel = backend.match(/export const NOTIFICATION_PUSH_CHANNEL_ID = '([^']+)'/)?.[1];
  const config = require('../app.config')();
  const plugin = config.plugins.find((entry) => Array.isArray(entry) && entry[0] === 'expo-notifications');
  assert.equal(channel, plugin[1].defaultChannel);
  assert.ok(plugin[1].sounds.includes(`./assets/sounds/${sound}`));
});
