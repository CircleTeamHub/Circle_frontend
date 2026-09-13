const { expo: baseConfig } = require('./app.json');

module.exports = () => {
  const easProjectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim();
  const googleServicesFile = process.env.GOOGLE_SERVICES_FILE?.trim();
  const isPreproduction = process.env.APP_VARIANT?.trim() === 'preprod';
  // 高德原生 SDK 的密钥。它在构建期写进 Info.plist / AndroidManifest，不配就不挂
  // 这个插件——地图会退回 Leaflet + OpenStreetMap，和接入前一致。
  // 带 EXPO_PUBLIC_ 前缀是因为运行时也要读它来判断该走哪套地图；密钥本来就会打进
  // 安装包，而且高德的移动端密钥绑定包名与签名，暴露在客户端是设计如此。
  const amapNativeKey = process.env.EXPO_PUBLIC_AMAP_NATIVE_KEY?.trim();

  return {
    ...baseConfig,
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
      ...(isPreproduction
        ? { package: `${baseConfig.android.package}.preprod` }
        : {}),
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
  };
};
