const { expo: baseConfig } = require('./app.json');

module.exports = () => {
  const easProjectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim();
  const googleServicesFile = process.env.GOOGLE_SERVICES_FILE?.trim();

  return {
    ...baseConfig,
    ...(easProjectId
      ? {
          extra: {
            ...(baseConfig.extra ?? {}),
            eas: {
              ...(baseConfig.extra?.eas ?? {}),
              projectId: easProjectId,
            },
          },
        }
      : {}),
    android: {
      ...baseConfig.android,
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
  };
};
