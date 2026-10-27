const {
  AndroidConfig,
  withAndroidManifest,
  withInfoPlist,
} = require('expo/config-plugins');

// 推送来电（modules/call-push，设计见 docs/superpowers/specs/2026-10-26-push-incoming-calls-design.md）。
//
// 安卓：jpush-react-native 的 JPushModuleReceiver 是唯一接 RECEIVER_MESSAGE 的组件。换成
// 继承它的 CallJPushReceiver —— 来电透传在原生层截下（JS 没跑也能全屏响铃），其余消息
// super 回原逻辑。替换必须写在 App 清单里：tools:node="remove" 只对优先级更低的清单生效，
// 写在库清单里取决于库之间的合并顺序，靠不住。
//
// iOS：UIBackgroundModes 加 voip，PushKit 才会把 VoIP 推送投给（含被杀掉的）App。
const JPUSH_RECEIVER = 'cn.jiguang.plugins.push.receiver.JPushModuleReceiver';
const CALL_RECEIVER = 'expo.modules.callpush.CallJPushReceiver';
const JPUSH_MESSAGE_ACTION = 'cn.jpush.android.intent.RECEIVER_MESSAGE';

function replaceJPushReceiver(androidManifest) {
  androidManifest.manifest.$ = {
    ...androidManifest.manifest.$,
    'xmlns:tools': 'http://schemas.android.com/tools',
  };
  const application =
    AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);
  const others = (application.receiver ?? []).filter(
    (receiver) =>
      ![JPUSH_RECEIVER, CALL_RECEIVER].includes(receiver.$?.['android:name']),
  );
  application.receiver = [
    ...others,
    {
      $: { 'android:name': JPUSH_RECEIVER, 'tools:node': 'remove' },
    },
    {
      $: {
        'android:name': CALL_RECEIVER,
        'android:enabled': 'true',
        'android:exported': 'false',
      },
      'intent-filter': [
        {
          action: [{ $: { 'android:name': JPUSH_MESSAGE_ACTION } }],
          category: [{ $: { 'android:name': '${applicationId}' } }],
        },
      ],
    },
  ];
  return androidManifest;
}

function addVoipBackgroundMode(infoPlist) {
  return {
    ...infoPlist,
    UIBackgroundModes: Array.from(
      new Set([...(infoPlist.UIBackgroundModes ?? []), 'voip']),
    ),
  };
}

function withCallPush(config) {
  const withManifest = withAndroidManifest(config, (modConfig) => {
    modConfig.modResults = replaceJPushReceiver(modConfig.modResults);
    return modConfig;
  });
  return withInfoPlist(withManifest, (modConfig) => {
    modConfig.modResults = addVoipBackgroundMode(modConfig.modResults);
    return modConfig;
  });
}

module.exports = withCallPush;
module.exports.replaceJPushReceiver = replaceJPushReceiver;
module.exports.addVoipBackgroundMode = addVoipBackgroundMode;
