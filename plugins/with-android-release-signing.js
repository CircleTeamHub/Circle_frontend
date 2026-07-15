const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = 'windnote-production-release-signing';
const RELEASE_SIGNING_BLOCK = `
// ${MARKER}
def windnoteReleaseSigning = [
    storeFile: System.getenv("ANDROID_KEYSTORE_PATH"),
    storePassword: System.getenv("ANDROID_KEYSTORE_PASSWORD"),
    keyAlias: System.getenv("ANDROID_KEY_ALIAS"),
    keyPassword: System.getenv("ANDROID_KEY_PASSWORD"),
]
def windnoteHasReleaseSigning = windnoteReleaseSigning.values().every { it?.trim() }

android {
    signingConfigs {
        release {
            if (windnoteReleaseSigning.storeFile?.trim()) {
                storeFile file(windnoteReleaseSigning.storeFile)
            }
            storePassword windnoteReleaseSigning.storePassword
            keyAlias windnoteReleaseSigning.keyAlias
            keyPassword windnoteReleaseSigning.keyPassword
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
        }
    }
}

def windnoteRequestsReleaseBuild = gradle.startParameter.taskNames.any { taskName ->
    taskName.toLowerCase().contains("release")
}
if (windnoteRequestsReleaseBuild && !windnoteHasReleaseSigning) {
    throw new GradleException(
        "Release signing is required. Configure ANDROID_KEYSTORE_PATH, " +
        "ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, and ANDROID_KEY_PASSWORD."
    )
}
`;

function appendAndroidReleaseSigning(content) {
  if (content.includes(MARKER)) {
    return content;
  }

  const separator = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
  return `${content}${separator}${RELEASE_SIGNING_BLOCK}`;
}

function applyReleaseSigningToModResults(modResults) {
  if (modResults.language !== 'groovy') {
    throw new Error('Android release signing requires a Groovy build.gradle file.');
  }

  return {
    ...modResults,
    contents: appendAndroidReleaseSigning(modResults.contents),
  };
}

function withAndroidReleaseSigning(config) {
  return withAppBuildGradle(config, (modConfig) => {
    modConfig.modResults = applyReleaseSigningToModResults(modConfig.modResults);

    return modConfig;
  });
}

module.exports = withAndroidReleaseSigning;
module.exports.appendAndroidReleaseSigning = appendAndroidReleaseSigning;
module.exports.applyReleaseSigningToModResults = applyReleaseSigningToModResults;
