const {
  AndroidConfig,
  withAndroidManifest,
} = require('expo/config-plugins');

function disableAndroidAllowBackup(androidManifest) {
  const mainApplication =
    AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);
  mainApplication.$['android:allowBackup'] = 'false';
  return androidManifest;
}

function withAndroidAllowBackupDisabled(config) {
  return withAndroidManifest(config, (modConfig) => {
    modConfig.modResults = disableAndroidAllowBackup(modConfig.modResults);
    return modConfig;
  });
}

module.exports = withAndroidAllowBackupDisabled;
module.exports.disableAndroidAllowBackup = disableAndroidAllowBackup;
