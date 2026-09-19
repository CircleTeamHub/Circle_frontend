const {
  withAppBuildGradle,
  withEntitlementsPlist,
  withInfoPlist,
} = require('expo/config-plugins');

function withJPush(config, options = {}) {
  const appKey = String(options.appKey || process.env.EXPO_PUBLIC_JPUSH_APP_KEY || '').trim();
  const channel = String(options.channel || 'windnote').trim();
  const production = options.production !== false;

  config = withAppBuildGradle(config, (modConfig) => {
    const placeholders = `\n        manifestPlaceholders.JPUSH_APPKEY = ${JSON.stringify(appKey)}\n        manifestPlaceholders.APP_CHANNEL = ${JSON.stringify(channel)}\n`;
    if (!modConfig.modResults.contents.includes('manifestPlaceholders.JPUSH_APPKEY')) {
      modConfig.modResults.contents = modConfig.modResults.contents.replace(
        /defaultConfig\s*\{/,
        (match) => `${match}${placeholders}`,
      );
    }
    return modConfig;
  });

  if (!appKey) return config;

  config = withInfoPlist(config, (modConfig) => {
    modConfig.modResults.UIBackgroundModes = Array.from(
      new Set([...(modConfig.modResults.UIBackgroundModes || []), 'remote-notification']),
    );
    return modConfig;
  });

  return withEntitlementsPlist(config, (modConfig) => {
    modConfig.modResults['aps-environment'] = production ? 'production' : 'development';
    return modConfig;
  });
}

module.exports = withJPush;
