const {
  AndroidConfig,
  withAndroidManifest,
  withEntitlementsPlist,
  withInfoPlist,
  withPodfileProperties,
} = require('expo/config-plugins');

// 推送来电（modules/call-push，设计见 docs/superpowers/specs/2026-10-26-push-incoming-calls-design.md）。
//
// 安卓：jpush-react-native 的 JPushModuleReceiver 是唯一接 RECEIVER_MESSAGE 的组件。换成
// 继承它的 CallJPushReceiver —— 来电透传在原生层截下（JS 没跑也能全屏响铃），其余消息
// super 回原逻辑。替换必须写在 App 清单里：tools:node="remove" 只对优先级更低的清单生效，
// 写在库清单里取决于库之间的合并顺序，靠不住。
//
// iOS 按构建期开关 iosMode 二选一（app.config.js 的 EXPO_PUBLIC_IOS_CALL_MODE）：
// - callkit（默认）：UIBackgroundModes 加 voip，PushKit 才会把 VoIP 推送投给（含被杀掉的）App；
// - notification（将来的中国区包）：不加 voip；加 time-sensitive 通知的 entitlement；并经
//   Podfile.properties.json 告诉 CallPush 的 podspec 把 CallKit / PushKit 整个编译出去 ——
//   二进制里不能出现 CallKit。
const IOS_CALL_MODES = new Set(['callkit', 'notification']);
const POD_PROPERTY = 'callPush.iosMode';
const TIME_SENSITIVE_ENTITLEMENT =
  'com.apple.developer.usernotifications.time-sensitive';
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

function removeVoipBackgroundMode(infoPlist) {
  const modes = (infoPlist.UIBackgroundModes ?? []).filter((mode) => mode !== 'voip');
  return { ...infoPlist, UIBackgroundModes: modes };
}

function withCallPush(config, options = {}) {
  const iosMode = options.iosMode ?? 'callkit';
  if (!IOS_CALL_MODES.has(iosMode)) {
    throw new Error(`with-call-push: iosMode must be callkit or notification, received ${iosMode}`);
  }
  let next = withAndroidManifest(config, (modConfig) => {
    modConfig.modResults = replaceJPushReceiver(modConfig.modResults);
    return modConfig;
  });
  next = withInfoPlist(next, (modConfig) => {
    modConfig.modResults =
      iosMode === 'callkit'
        ? addVoipBackgroundMode(modConfig.modResults)
        : removeVoipBackgroundMode(modConfig.modResults);
    return modConfig;
  });
  next = withPodfileProperties(next, (modConfig) => {
    modConfig.modResults = { ...modConfig.modResults, [POD_PROPERTY]: iosMode };
    return modConfig;
  });
  if (iosMode === 'notification') {
    next = withEntitlementsPlist(next, (modConfig) => {
      modConfig.modResults = {
        ...modConfig.modResults,
        [TIME_SENSITIVE_ENTITLEMENT]: true,
      };
      return modConfig;
    });
  }
  return next;
}

module.exports = withCallPush;
module.exports.replaceJPushReceiver = replaceJPushReceiver;
module.exports.addVoipBackgroundMode = addVoipBackgroundMode;
module.exports.removeVoipBackgroundMode = removeVoipBackgroundMode;
