const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const read = (relativePath) =>
  fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

test('Android releases publish a consistently named APK to the public repository', () => {
  const workflow = read('.github/workflows/android-release.yml');

  assert.match(workflow, /tags:\s*\n\s*- ['"]v\*['"]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /group: android-release-publish/);
  assert.match(workflow, /ref: refs\/tags\/\$\{\{ env\.RELEASE_TAG \}\}/);
  assert.match(workflow, /refs\/tags\/\$RELEASE_TAG\^\{commit\}/);
  assert.match(
    workflow,
    /npx expo prebuild --platform android --clean --no-install/,
  );
  assert.match(workflow, /\.\/gradlew assembleRelease/);
  assert.match(workflow, /CircleTeamHub\/windnote-releases/);
  assert.match(workflow, /windnote\.apk/);
  assert.match(workflow, /secrets\.RELEASES_TOKEN/);
  assert.match(workflow, /secrets\.ANDROID_KEYSTORE_BASE64/);
  assert.doesNotMatch(workflow, /--clobber/);
});

test('the Expo config applies production signing to generated Android projects', () => {
  const app = JSON.parse(read('app.json')).expo;
  const {
    appendAndroidReleaseSigning,
    applyReleaseSigningToModResults,
  } = require('../plugins/with-android-release-signing');
  const generatedGradle = 'android {\n    buildTypes {\n        release {\n            signingConfig signingConfigs.debug\n        }\n    }\n}\n';
  const gradle = appendAndroidReleaseSigning(generatedGradle);

  assert.ok(app.plugins.includes('./plugins/with-android-release-signing'));
  assert.match(gradle, /ANDROID_KEYSTORE_PATH/);
  assert.match(gradle, /ANDROID_KEYSTORE_PASSWORD/);
  assert.match(gradle, /ANDROID_KEY_ALIAS/);
  assert.match(gradle, /ANDROID_KEY_PASSWORD/);
  assert.match(gradle, /signingConfig signingConfigs\.release/);
  assert.equal(
    appendAndroidReleaseSigning(gradle),
    gradle,
    'the signing config plugin must be idempotent',
  );
  assert.throws(
    () => applyReleaseSigningToModResults({ language: 'kotlin', contents: '' }),
    /Groovy/,
  );
});

test('release validation requires production config and matching app versions', () => {
  const {
    validateReleaseConfig,
  } = require('../.github/scripts/validate-android-release');
  const env = {
    RELEASE_TAG: 'v1.0.0',
    ANDROID_KEYSTORE_BASE64: 'a2V5c3RvcmU=',
    ANDROID_KEYSTORE_PASSWORD: 'store-password',
    ANDROID_KEY_ALIAS: 'windnote',
    ANDROID_KEY_PASSWORD: 'key-password',
    ANDROID_CERT_SHA256: 'a'.repeat(64),
    RELEASES_TOKEN: 'token',
    EXPO_PUBLIC_API_URL: 'https://api.windnote.test',
    EXPO_PUBLIC_OPENIM_API_URL: 'https://im.windnote.test',
    EXPO_PUBLIC_OPENIM_WS_URL: 'wss://im.windnote.test/ws',
  };
  const app = { version: '1.0.0', android: { versionCode: 1_000_000 } };

  assert.deepEqual(validateReleaseConfig({ env, app }), []);

  for (const name of [
    'ANDROID_KEYSTORE_BASE64',
    'ANDROID_KEYSTORE_PASSWORD',
    'ANDROID_KEY_ALIAS',
    'ANDROID_KEY_PASSWORD',
    'ANDROID_CERT_SHA256',
    'RELEASES_TOKEN',
    'EXPO_PUBLIC_API_URL',
    'EXPO_PUBLIC_OPENIM_API_URL',
    'EXPO_PUBLIC_OPENIM_WS_URL',
  ]) {
    assert.match(
      validateReleaseConfig({ env: { ...env, [name]: '' }, app }).join('\n'),
      new RegExp(name),
    );
  }

  assert.match(
    validateReleaseConfig({
      env: { ...env, EXPO_PUBLIC_API_URL: 'http://api.windnote.test' },
      app,
    }).join('\n'),
    /EXPO_PUBLIC_API_URL.*https/,
  );
  assert.match(
    validateReleaseConfig({ env: { ...env, RELEASE_TAG: 'v1.0.1' }, app }).join(
      '\n',
    ),
    /does not match app version/,
  );
  assert.match(
    validateReleaseConfig({ env: { ...env, RELEASE_TAG: 'v1.0.0-beta.1' }, app }).join(
      '\n',
    ),
    /stable semantic version/,
  );
  assert.match(
    validateReleaseConfig({
      env,
      app: { ...app, android: { versionCode: 1 } },
    }).join('\n'),
    /versionCode.*1000000/,
  );
});

test('release publishing is immutable and only advances a newer stable version', () => {
  const { publishRelease } = require('../.github/scripts/publish-android-release');
  const apkPath = path.join(process.cwd(), 'test', 'fixture-windnote.apk');
  const apkContents = Buffer.from('signed apk fixture');
  const digest = `sha256:${crypto.createHash('sha256').update(apkContents).digest('hex')}`;
  fs.writeFileSync(apkPath, apkContents);

  try {
    const createCalls = [];
    publishRelease({
      releaseTag: 'v1.0.0',
      repository: 'CircleTeamHub/windnote-releases',
      apkPath,
      runGh(args) {
        createCalls.push(args);
        if (args.some((arg) => arg.endsWith('/releases/tags/v1.0.0'))) return { status: 1, stdout: '', stderr: 'HTTP 404' };
        if (args.some((arg) => arg.endsWith('/releases/latest'))) return { status: 1, stdout: '', stderr: 'HTTP 404' };
        return { status: 0, stdout: '' };
      },
    });
    assert.ok(createCalls.some((args) => args[0] === 'release' && args[1] === 'create'));
    assert.ok(createCalls.some((args) => args.includes('--latest=false')));
    assert.ok(createCalls.some((args) => args[0] === 'release' && args[1] === 'edit' && args.includes('--latest')));
    assert.ok(createCalls.some((args) => args.includes(`${apkPath}#windnote.apk`)));

    const rerunCalls = [];
    publishRelease({
      releaseTag: 'v1.0.0',
      repository: 'CircleTeamHub/windnote-releases',
      apkPath,
      runGh(args) {
        rerunCalls.push(args);
        if (args.some((arg) => arg.endsWith('/releases/tags/v1.0.0'))) {
          return {
            status: 0,
            stdout: JSON.stringify({ assets: [{ name: 'windnote.apk', digest }] }),
          };
        }
        if (args.some((arg) => arg.endsWith('/releases/latest'))) return { status: 0, stdout: 'v2.0.0\n' };
        return { status: 0, stdout: '' };
      },
    });
    assert.equal(rerunCalls.some((args) => args[0] === 'release' && args[1] === 'upload'), false);
    assert.equal(rerunCalls.some((args) => args.includes('--latest')), false);

    let failedLookupCalls = 0;
    assert.throws(
      () =>
        publishRelease({
          releaseTag: 'v1.0.0',
          repository: 'CircleTeamHub/windnote-releases',
          apkPath,
          runGh(args) {
            if (args.some((arg) => arg.endsWith('/releases/tags/v1.0.0'))) {
              return {
                status: 0,
                stdout: JSON.stringify({
                  assets: [{ name: 'windnote.apk', digest: `sha256:${'0'.repeat(64)}` }],
                }),
              };
            }
            return { status: 0, stdout: 'v1.0.0\n' };
          },
        }),
      /different digest/,
    );

    assert.throws(
      () =>
        publishRelease({
          releaseTag: 'v1.0.0',
          repository: 'CircleTeamHub/windnote-releases',
          apkPath,
          runGh() {
            failedLookupCalls += 1;
            return { status: 1, stdout: '', stderr: 'HTTP 500' };
          },
        }),
      /HTTP 500/,
    );
    assert.equal(failedLookupCalls, 1, 'publishing must stop after a failed lookup');
  } finally {
    fs.rmSync(apkPath, { force: true });
  }
});
