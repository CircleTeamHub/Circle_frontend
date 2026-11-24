const { withAndroidManifest } = require('expo/config-plugins');

/**
 * 诊断用：让 adb shell 能对这个包做原生内存 / CPU 剖析（perfetto heapprofd、simpleperf）。
 * 不等于 debuggable —— 不能附加调试器，也读不到应用数据。只挂在预发包上，正式包不加。
 */
module.exports = function withAndroidProfileable(config) {
  return withAndroidManifest(config, (manifestConfig) => {
    const application = manifestConfig.modResults.manifest.application[0];
    application.profileable = [{ $: { 'android:shell': 'true' } }];
    return manifestConfig;
  });
};
