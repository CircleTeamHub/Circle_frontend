const { expo: baseConfig } = require('./app.json');

module.exports = () => {
  const configuredEasProjectId = baseConfig.extra?.eas?.projectId;
  const easProjectId =
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim() ||
    (typeof configuredEasProjectId === 'string'
      ? configuredEasProjectId.trim()
      : undefined);
  const googleServicesFile = process.env.GOOGLE_SERVICES_FILE?.trim();
  const isPreproduction = process.env.APP_VARIANT?.trim() === 'preprod';
  const jpushAppKey = process.env.EXPO_PUBLIC_JPUSH_APP_KEY?.trim();
  const configuredPushProvider = process.env.EXPO_PUBLIC_PUSH_PROVIDER?.trim();
  if (
    configuredPushProvider &&
    !new Set(['expo', 'jpush']).has(configuredPushProvider)
  ) {
    throw new Error(
      `EXPO_PUBLIC_PUSH_PROVIDER must be expo or jpush, received ${configuredPushProvider}`,
    );
  }
  if (configuredPushProvider === 'jpush' && !jpushAppKey) {
    throw new Error(
      'EXPO_PUBLIC_PUSH_PROVIDER=jpush requires EXPO_PUBLIC_JPUSH_APP_KEY',
    );
  }
  const pushProvider = configuredPushProvider || (jpushAppKey ? 'jpush' : 'expo');
  // iOS 来电的构建期开关（不做运行时地区判断）：默认 callkit = PushKit + CallKit；
  // notification 留给将来的中国区 App Store 包 —— 工信部要求中国区停用 CallKit，而 iOS 13 起
  // VoIP 推送必须上报 CallKit，所以该包把 CallKit / PushKit 整个编译出去，改由服务端经极光发
  // time-sensitive 通知 + 自带铃声（≤30 秒）。
  const iosCallMode = process.env.EXPO_PUBLIC_IOS_CALL_MODE?.trim() || 'callkit';
  if (!new Set(['callkit', 'notification']).has(iosCallMode)) {
    throw new Error(
      `EXPO_PUBLIC_IOS_CALL_MODE must be callkit or notification, received ${iosCallMode}`,
    );
  }
  if (iosCallMode === 'notification' && pushProvider !== 'jpush') {
    throw new Error(
      'EXPO_PUBLIC_IOS_CALL_MODE=notification rings through JPush and requires EXPO_PUBLIC_JPUSH_APP_KEY',
    );
  }
  const jpushProduction = !isPreproduction;
  const updateChannel = isPreproduction ? 'preview' : 'production';
  // 高德移动端密钥分别绑定 Android 包名+签名与 iOS Bundle ID，不能跨平台复用。
  // 不配对应平台的 key 时，该平台运行时会回落到 Leaflet + OpenStreetMap。
  const amapAndroidKey = process.env.EXPO_PUBLIC_AMAP_ANDROID_KEY?.trim();
  const amapIosKey = process.env.EXPO_PUBLIC_AMAP_IOS_KEY?.trim();
  const legacyAmapKey = process.env.EXPO_PUBLIC_AMAP_NATIVE_KEY?.trim();
  if (legacyAmapKey && !amapAndroidKey && !amapIosKey) {
    throw new Error(
      'EXPO_PUBLIC_AMAP_NATIVE_KEY is no longer supported; configure EXPO_PUBLIC_AMAP_ANDROID_KEY and/or EXPO_PUBLIC_AMAP_IOS_KEY',
    );
  }

  return {
    ...baseConfig,
    // OTA updates only replace the JavaScript/assets bundle. Native changes
    // still require a new APK/IPA and use the existing binary updater.
    runtimeVersion: {
      policy: 'appVersion',
    },
    ...(easProjectId
      ? {
          updates: {
            url: `https://u.expo.dev/${easProjectId}`,
            requestHeaders: {
              'expo-channel-name': updateChannel,
            },
            checkAutomatically: 'ON_LOAD',
            fallbackToCacheTimeout: 0,
          },
        }
      : {}),
    plugins: [
      // 通知模式的来电铃声要进 iOS 包（APNs 的 sound 只能引用包内文件）；CallKit 包用系统铃声。
      ...(baseConfig.plugins ?? []).map((plugin) =>
        plugin === 'expo-notifications' && iosCallMode === 'notification'
          ? ['expo-notifications', { sounds: ['./assets/sounds/call_ring.caf'] }]
          : plugin,
      ),
      ...(amapAndroidKey || amapIosKey
        ? [
            [
              'expo-gaode-map',
              {
                ...(amapAndroidKey ? { androidKey: amapAndroidKey } : {}),
                ...(amapIosKey ? { iosKey: amapIosKey } : {}),
              },
            ],
          ]
        : []),
      ['./plugins/with-call-push', { iosMode: iosCallMode }],
      [
        './plugins/with-jpush',
        {
          appKey: jpushAppKey ?? '',
          channel: 'windnote',
          production: !isPreproduction,
        },
      ],
    ],
    ...(isPreproduction
      ? {
          name: `${baseConfig.name}测试版`,
          scheme: ['windnoteai-preprod', 'circleim-preprod'],
        }
      : {}),
    extra: {
      ...(baseConfig.extra ?? {}),
      appVariant: isPreproduction ? 'preprod' : 'production',
      pushProvider,
      iosCallMode,
      jpushProduction,
      ...(jpushAppKey ? { jpushAppKey } : {}),
      ...(easProjectId
        ? {
            eas: {
              ...(baseConfig.extra?.eas ?? {}),
              projectId: easProjectId,
            },
          }
        : {}),
    },
    android: {
      ...baseConfig.android,
      permissions: Array.from(
        new Set([
          ...(baseConfig.android?.permissions ?? []),
          'android.permission.POST_NOTIFICATIONS',
        ]),
      ),
      ...(isPreproduction
        ? { package: `${baseConfig.android.package}.preprod` }
        : {}),
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
  };
};
