const { withGradleProperties } = require('expo/config-plugins');

// Expo Updates adds Room/KSP2 analysis inside the Gradle daemon. The Expo
// template's 512 MiB metaspace limit is insufficient for this native build graph.
const GRADLE_JVM_ARGS =
  '-Xmx2048m -XX:MaxMetaspaceSize=1024m -XX:+ExitOnOutOfMemoryError';

function configureGradleJvmArgs(properties) {
  const existing = properties.find(
    (property) =>
      property.type === 'property' && property.key === 'org.gradle.jvmargs',
  );

  if (existing) {
    existing.value = GRADLE_JVM_ARGS;
  } else {
    properties.push({
      type: 'property',
      key: 'org.gradle.jvmargs',
      value: GRADLE_JVM_ARGS,
    });
  }

  return properties;
}

function withAndroidGradleMemory(config) {
  return withGradleProperties(config, (modConfig) => {
    modConfig.modResults = configureGradleJvmArgs(modConfig.modResults);
    return modConfig;
  });
}

module.exports = withAndroidGradleMemory;
module.exports.configureGradleJvmArgs = configureGradleJvmArgs;
