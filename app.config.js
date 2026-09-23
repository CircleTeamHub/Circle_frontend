const { expo: baseConfig } = require('./app.json');

module.exports = () => {
  const easProjectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim();
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
    plugins: [
      ...(baseConfig.plugins ?? []),
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
