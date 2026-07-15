const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

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

test('release validation metadata requires matching app versions and secure public URLs', () => {
  const {
    validateReleaseMetadata,
  } = require('../.github/scripts/validate-android-release');
  const env = {
    RELEASE_TAG: 'v1.0.0',
    EXPO_PUBLIC_API_URL: 'https://api.windnote.test',
    EXPO_PUBLIC_OPENIM_API_URL: 'https://im.windnote.test',
    EXPO_PUBLIC_OPENIM_WS_URL: 'wss://im.windnote.test/ws',
  };
  const app = { version: '1.0.0', android: { versionCode: 1_000_000 } };

  assert.deepEqual(validateReleaseMetadata({ env, app }), []);

  for (const name of [
    'EXPO_PUBLIC_API_URL',
    'EXPO_PUBLIC_OPENIM_API_URL',
    'EXPO_PUBLIC_OPENIM_WS_URL',
  ]) {
    assert.match(
      validateReleaseMetadata({ env: { ...env, [name]: '' }, app }).join('\n'),
      new RegExp(name),
    );
  }

  assert.match(
    validateReleaseMetadata({
      env: { ...env, EXPO_PUBLIC_API_URL: 'http://api.windnote.test' },
      app,
    }).join('\n'),
    /EXPO_PUBLIC_API_URL.*https/,
  );
  assert.match(
    validateReleaseMetadata({
      env: {
        ...env,
        EXPO_PUBLIC_OPENIM_WS_URL: 'wss://user:password@im.windnote.test/ws',
      },
      app,
    }).join('\n'),
    /EXPO_PUBLIC_OPENIM_WS_URL.*wss.*without embedded credentials/,
  );
  assert.match(
    validateReleaseMetadata({ env: { ...env, RELEASE_TAG: 'v1.0.1' }, app }).join(
      '\n',
    ),
    /does not match app version/,
  );
  assert.match(
    validateReleaseMetadata({
      env: { ...env, RELEASE_TAG: 'v1.0.0-beta.1' },
      app,
    }).join('\n'),
    /stable semantic version/,
  );
  assert.match(
    validateReleaseMetadata({
      env: { ...env, RELEASE_TAG: 'v01.0.0' },
      app,
    }).join('\n'),
    /stable semantic version/,
  );
  assert.match(
    validateReleaseMetadata({
      env,
      app: { ...app, android: { versionCode: 1 } },
    }).join('\n'),
    /versionCode.*1000000/,
  );

  assert.deepEqual(
    validateReleaseMetadata({
      env: {
        ...env,
        ANDROID_KEYSTORE_BASE64: '',
        ANDROID_CERT_SHA256: 'invalid',
        RELEASES_TOKEN: '',
        ANDROID_PUBLIC_RELEASE_ENABLED: 'false',
      },
      app,
    }),
    [],
    'metadata validation must not inspect signing or distribution settings',
  );
});

test('release validation signing requires credentials and a SHA-256 fingerprint', () => {
  const {
    validateSigningConfig,
  } = require('../.github/scripts/validate-android-release');
  const env = {
    ANDROID_KEYSTORE_BASE64: 'a2V5c3RvcmU=',
    ANDROID_KEYSTORE_PASSWORD: 'store-password',
    ANDROID_KEY_ALIAS: 'windnote',
    ANDROID_KEY_PASSWORD: 'key-password',
    ANDROID_CERT_SHA256: Array(32).fill('aB').join(':'),
  };

  assert.deepEqual(validateSigningConfig({ env }), []);

  for (const name of [
    'ANDROID_KEYSTORE_BASE64',
    'ANDROID_KEYSTORE_PASSWORD',
    'ANDROID_KEY_ALIAS',
    'ANDROID_KEY_PASSWORD',
    'ANDROID_CERT_SHA256',
  ]) {
    assert.match(
      validateSigningConfig({ env: { ...env, [name]: '' } }).join('\n'),
      new RegExp(name),
    );
  }

  assert.match(
    validateSigningConfig({
      env: { ...env, ANDROID_CERT_SHA256: 'g'.repeat(64) },
    }).join('\n'),
    /SHA-256 certificate fingerprint/,
  );

  const contiguousFingerprint = 'ab'.repeat(32);
  assert.deepEqual(
    validateSigningConfig({
      env: { ...env, ANDROID_CERT_SHA256: contiguousFingerprint },
    }),
    [],
  );

  for (const fingerprint of [
    `:${contiguousFingerprint}`,
    `${contiguousFingerprint}:`,
    `ab::cd:${Array(30).fill('ef').join(':')}`,
    `${'a'.repeat(3)}:${'b'.repeat(61)}`,
  ]) {
    assert.match(
      validateSigningConfig({
        env: { ...env, ANDROID_CERT_SHA256: fingerprint },
      }).join('\n'),
      /SHA-256 certificate fingerprint/,
    );
  }
});

test('release validation distribution requires explicit approval and secure evidence', () => {
  const {
    validateDistributionApproval,
  } = require('../.github/scripts/validate-android-release');
  const env = {
    ANDROID_PUBLIC_RELEASE_ENABLED: 'true',
    ANDROID_DISTRIBUTION_APPROVED: 'true',
    ANDROID_DISTRIBUTION_EVIDENCE_URL:
      'https://compliance.windnote.test/releases/1.0.0',
  };

  assert.deepEqual(validateDistributionApproval({ env }), []);

  for (const name of [
    'ANDROID_PUBLIC_RELEASE_ENABLED',
    'ANDROID_DISTRIBUTION_APPROVED',
  ]) {
    assert.match(
      validateDistributionApproval({ env: { ...env, [name]: 'false' } }).join(
        '\n',
      ),
      new RegExp(`${name}.*true`),
    );
  }

  assert.match(
    validateDistributionApproval({
      env: {
        ...env,
        ANDROID_DISTRIBUTION_EVIDENCE_URL:
          'https://reviewer:secret@compliance.windnote.test/releases/1.0.0',
      },
    }).join('\n'),
    /ANDROID_DISTRIBUTION_EVIDENCE_URL.*https.*without embedded credentials/,
  );
  assert.match(
    validateDistributionApproval({
      env: { ...env, ANDROID_DISTRIBUTION_EVIDENCE_URL: '' },
    }).join('\n'),
    /ANDROID_DISTRIBUTION_EVIDENCE_URL.*required/,
  );
});

test('release validation CLI supports scoped and legacy validation', () => {
  const script = path.join(
    process.cwd(),
    '.github/scripts/validate-android-release.js',
  );
  const metadataEnv = {
    RELEASE_TAG: 'v1.0.0',
    EXPO_PUBLIC_API_URL: 'https://api.windnote.test',
    EXPO_PUBLIC_OPENIM_API_URL: 'https://im.windnote.test',
    EXPO_PUBLIC_OPENIM_WS_URL: 'wss://im.windnote.test/ws',
  };
  const signingEnv = {
    ANDROID_KEYSTORE_BASE64: 'a2V5c3RvcmU=',
    ANDROID_KEYSTORE_PASSWORD: 'store-password',
    ANDROID_KEY_ALIAS: 'windnote',
    ANDROID_KEY_PASSWORD: 'key-password',
    ANDROID_CERT_SHA256: 'a'.repeat(64),
  };
  const distributionEnv = {
    ANDROID_PUBLIC_RELEASE_ENABLED: 'true',
    ANDROID_DISTRIBUTION_APPROVED: 'true',
    ANDROID_DISTRIBUTION_EVIDENCE_URL:
      'https://compliance.windnote.test/releases/1.0.0',
  };
  const legacyEnv = {
    ...metadataEnv,
    ...signingEnv,
    RELEASES_TOKEN: 'release-token',
  };
  const run = (args, env) =>
    spawnSync(process.execPath, [script, ...args], {
      cwd: process.cwd(),
      env: { PATH: process.env.PATH, ...env },
      encoding: 'utf8',
    });

  assert.equal(run(['metadata'], metadataEnv).status, 0);
  assert.equal(run(['signing'], signingEnv).status, 0);
  assert.equal(run(['distribution'], distributionEnv).status, 0);
  assert.equal(
    run(['all'], {
      ...metadataEnv,
      ...signingEnv,
      ...distributionEnv,
    }).status,
    0,
  );
  assert.equal(run([], legacyEnv).status, 0);

  const missingLegacyToken = run([], {
    ...metadataEnv,
    ...signingEnv,
  });
  assert.equal(missingLegacyToken.status, 1);
  assert.match(missingLegacyToken.stderr, /::error::RELEASES_TOKEN is required/);

  const explicitAllFailure = run(['all'], legacyEnv);
  assert.equal(explicitAllFailure.status, 1);
  assert.match(
    explicitAllFailure.stderr,
    /::error::ANDROID_PUBLIC_RELEASE_ENABLED.*true/,
  );

  const unknownScope = run(['publishing'], {});
  assert.equal(unknownScope.status, 1);
  assert.match(unknownScope.stderr, /::error::Unknown validation scope: publishing/);
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
