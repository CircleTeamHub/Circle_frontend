const { expo: baseConfig } = require('./app.json');

module.exports = () => {
  const easProjectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim();
  const googleServicesFile = process.env.GOOGLE_SERVICES_FILE?.trim();

  // Release versioning (CI only): release-android.yml sets these from the git
  // tag / run number before `expo prebuild`, so the tag is the single source
  // of truth for the shipped version. Local builds keep app.json defaults.
  const appVersion = process.env.CIRCLE_APP_VERSION?.trim();
  const androidVersionCode = Number.parseInt(
    process.env.CIRCLE_ANDROID_VERSION_CODE ?? '',
    10,
  );

  return {
    ...baseConfig,
    ...(appVersion ? { version: appVersion } : {}),
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
      ...(Number.isInteger(androidVersionCode) && androidVersionCode > 0
        ? { versionCode: androidVersionCode }
        : {}),
    },
  };
};
