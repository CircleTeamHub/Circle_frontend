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
  // 高德原生 SDK 的密钥按平台签发，不能复用。它们在构建期分别写进
  // Info.plist / AndroidManifest；两个都不配才不挂插件。
  // 带 EXPO_PUBLIC_ 前缀是因为运行时也要读它来判断该走哪套地图；密钥本来就会打进
  // 安装包，而且高德的移动端密钥绑定包名与签名，暴露在客户端是设计如此。
  const amapIosKey = process.env.EXPO_PUBLIC_AMAP_IOS_KEY?.trim();
  const amapAndroidKey = process.env.EXPO_PUBLIC_AMAP_ANDROID_KEY?.trim();

  return {
    ...baseConfig,
    plugins: [
      ...(baseConfig.plugins ?? []),
      ...(amapIosKey || amapAndroidKey
        ? [
            [
              'expo-amap',
              {
                apiKey: {
                  ...(amapIosKey ? { ios: amapIosKey } : {}),
                  ...(amapAndroidKey ? { android: amapAndroidKey } : {}),
                },
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
