const {
  withAndroidManifest,
  withEntitlementsPlist,
  withInfoPlist,
} = require('expo/config-plugins');

function withJPush(config, options = {}) {
  const appKey = String(options.appKey || process.env.EXPO_PUBLIC_JPUSH_APP_KEY || '').trim();
  const channel = String(options.channel || 'windnote').trim();
  const production = options.production !== false;

  config = withAndroidManifest(config, (modConfig) => {
    const application = modConfig.modResults.manifest.application?.[0];
    if (!application) throw new Error('JPush requires an Android application manifest node.');
    application['meta-data'] = application['meta-data'] || [];
    const metadata = application['meta-data'];
    for (const [name, value] of [
      ['JPUSH_APPKEY', appKey],
      ['JPUSH_CHANNEL', channel],
    ]) {
      const existing = metadata.find((item) => item.$?.['android:name'] === name);
      if (existing) existing.$['android:value'] = value;
      else metadata.push({ $: { 'android:name': name, 'android:value': value } });
    }
    return modConfig;
  });

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
