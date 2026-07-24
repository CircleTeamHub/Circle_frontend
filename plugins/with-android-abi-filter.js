const { withGradleProperties } = require('expo/config-plugins');

/**
 * 限制打包进 APK 的 native ABI，砍掉体积。
 *
 * 背景：@livekit/react-native-webrtc 等库为每个 ABI 各带一份 .so，默认 4 个
 * ABI(armeabi-v7a/arm64-v8a/x86/x86_64)会让 APK 膨胀数倍。x86/x86_64 只有
 * 老式 Intel 模拟器需要——Apple Silicon 上的模拟器是 arm64-v8a，真机也全是
 * arm64-v8a，因此默认只保留 arm64-v8a。要支持 32 位老机型时把 armeabi-v7a
 * 加回 abis 即可(会增大体积)。
 *
 * android/ 是 CNG(prebuild)生成物且 gitignore，直接改 gradle.properties 会被
 * prebuild --clean 冲掉，所以用 config plugin 在 prebuild 时写入，保证持久。
 */
module.exports = function withAndroidAbiFilter(config, { abis = 'arm64-v8a' } = {}) {
  return withGradleProperties(config, (cfg) => {
    const key = 'reactNativeArchitectures';
    const existing = cfg.modResults.find(
      (item) => item.type === 'property' && item.key === key,
    );
    if (existing) {
      existing.value = abis;
    } else {
      cfg.modResults.push({ type: 'property', key, value: abis });
    }
    return cfg;
  });
};
