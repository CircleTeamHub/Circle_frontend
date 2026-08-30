const { expo: baseConfig } = require('./app.json');

module.exports = () => {
  const easProjectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim();
  const googleServicesFile = process.env.GOOGLE_SERVICES_FILE?.trim();
  const isPreproduction = process.env.APP_VARIANT?.trim() === 'preprod';

  return {
    ...baseConfig,
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
