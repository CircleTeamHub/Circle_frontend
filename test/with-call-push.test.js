const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  addVoipBackgroundMode,
  replaceJPushReceiver,
} = require('../plugins/with-call-push');

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

test('swaps the JPush receiver for the call-aware subclass in the app manifest', () => {
  const result = replaceJPushReceiver(
    manifest([{ $: { 'android:name': 'some.other.Receiver' } }]),
  );
  const receivers = result.manifest.application[0].receiver;

  assert.equal(result.manifest.$['xmlns:tools'], 'http://schemas.android.com/tools');
  assert.deepEqual(receivers[0], { $: { 'android:name': 'some.other.Receiver' } });
  // tools:node=remove 写在 App 清单里才压得过库清单。
  assert.deepEqual(receivers.find((r) => r.$['android:name'] === JPUSH_RECEIVER), {
    $: { 'android:name': JPUSH_RECEIVER, 'tools:node': 'remove' },
  });
  const call = receivers.find((r) => r.$['android:name'] === CALL_RECEIVER);
  assert.equal(call.$['android:exported'], 'false');
  assert.deepEqual(call['intent-filter'], [
    {
      action: [{ $: { 'android:name': 'cn.jpush.android.intent.RECEIVER_MESSAGE' } }],
      category: [{ $: { 'android:name': '${applicationId}' } }],
    },
  ]);
});

test('is idempotent across repeated prebuilds', () => {
  const once = replaceJPushReceiver(manifest());
  const twice = replaceJPushReceiver(once);
  const names = twice.manifest.application[0].receiver.map((r) => r.$['android:name']);

  assert.deepEqual(names.sort(), [CALL_RECEIVER, JPUSH_RECEIVER].sort());
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

test('the app config applies the plugin', () => {
  const app = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'app.json'), 'utf8'));
  assert.ok(app.expo.plugins.includes('./plugins/with-call-push'));
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
