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
  const jpushProduction = !isPreproduction;
  const updateChannel = isPreproduction ? 'preview' : 'production';
  // 高德原生 SDK 的密钥。它在构建期写进 Info.plist / AndroidManifest，不配就不挂
  // 这个插件——地图会退回 Leaflet + OpenStreetMap，和接入前一致。
  // 带 EXPO_PUBLIC_ 前缀是因为运行时也要读它来判断该走哪套地图；密钥本来就会打进
  // 安装包，而且高德的移动端密钥绑定包名与签名，暴露在客户端是设计如此。
  const amapNativeKey = process.env.EXPO_PUBLIC_AMAP_NATIVE_KEY?.trim();

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
      ...(baseConfig.plugins ?? []),
      ...(amapNativeKey
        ? [
            [
              'expo-amap',
              { apiKey: { ios: amapNativeKey, android: amapNativeKey } },
            ],
          ]
        : []),
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
