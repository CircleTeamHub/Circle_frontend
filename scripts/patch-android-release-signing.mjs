// Wire real release signing into the `expo prebuild`-generated Gradle project.
//
// android/ is gitignored (CNG): the native project is regenerated in CI on
// every release, and Expo's template signs release builds with the DEBUG
// keystore. This script runs right after prebuild (see
// .github/workflows/release-android.yml) and rewrites
// android/app/build.gradle so the release build type uses a keystore supplied
// via Gradle project properties (ORG_GRADLE_PROJECT_circleRelease*), falling
// back to debug signing when they are absent (local `expo run:android`).
//
// Same repo pattern as scripts/patch-openim-native-events.mjs: patch a
// generated/vendored file deterministically, fail loudly if the anchor text
// drifts (Expo template change), and stay idempotent.
import { readFileSync, writeFileSync } from 'node:fs';

const GRADLE_PATH = 'android/app/build.gradle';

const DEBUG_SIGNING_BLOCK = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }`;

const PATCHED_SIGNING_BLOCK = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        release {
            // Injected by scripts/patch-android-release-signing.mjs (CI).
            if (findProperty('circleReleaseStoreFile')) {
                storeFile file(circleReleaseStoreFile)
                storePassword circleReleaseStorePassword
                keyAlias circleReleaseKeyAlias
                keyPassword circleReleaseKeyPassword
            }
        }
    }`;

const RELEASE_SIGNING_LINE =
  'signingConfig signingConfigs.debug\n' +
  '            def enableShrinkResources';

const PATCHED_RELEASE_SIGNING_LINE =
  'signingConfig(findProperty(\'circleReleaseStoreFile\') ? signingConfigs.release : signingConfigs.debug)\n' +
  '            def enableShrinkResources';

const source = readFileSync(GRADLE_PATH, 'utf8');

if (source.includes('circleReleaseStoreFile')) {
  console.log(`${GRADLE_PATH} already patched; nothing to do.`);
  process.exit(0);
}

if (!source.includes(DEBUG_SIGNING_BLOCK)) {
  console.error(
    `Anchor not found in ${GRADLE_PATH}: signingConfigs block. ` +
      'The Expo template likely changed — update patch-android-release-signing.mjs.',
  );
  process.exit(1);
}
if (!source.includes(RELEASE_SIGNING_LINE)) {
  console.error(
    `Anchor not found in ${GRADLE_PATH}: release buildType signingConfig line. ` +
      'The Expo template likely changed — update patch-android-release-signing.mjs.',
  );
  process.exit(1);
}

const patched = source
  .replace(DEBUG_SIGNING_BLOCK, PATCHED_SIGNING_BLOCK)
  .replace(RELEASE_SIGNING_LINE, PATCHED_RELEASE_SIGNING_LINE);

writeFileSync(GRADLE_PATH, patched);
console.log(`${GRADLE_PATH}: release signing config injected.`);
