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
    // 原生 SDK(cn.jiguang.sdk:jcore / jpush)的清单要 JPUSH_APPKEY 与 JPUSH_CHANNEL;
    // APP_CHANNEL 是 jpush-react-native 示例工程的写法,一并设上。
    const placeholders = [
      `manifestPlaceholders.JPUSH_APPKEY = ${JSON.stringify(appKey)}`,
      `manifestPlaceholders.JPUSH_CHANNEL = ${JSON.stringify(channel)}`,
      `manifestPlaceholders.APP_CHANNEL = ${JSON.stringify(channel)}`,
    ]
      .map((line) => `\n        ${line}`)
      .join('')
      .concat('\n');
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
