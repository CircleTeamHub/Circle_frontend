const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const read = (relativePath) =>
  fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

const workflowJob = (workflow, jobName) => {
  const jobs = workflow.slice(workflow.indexOf('\njobs:'));
  const header = `\n  ${jobName}:`;
  const start = jobs.indexOf(header);
  assert.notEqual(start, -1, `expected ${jobName} job`);
  const remainder = jobs.slice(start + header.length);
  const nextJob = remainder.search(/^  [a-z][a-z0-9-]*:\s*$/m);
  return nextJob === -1 ? remainder : remainder.slice(0, nextJob);
};

const workflowStep = (job, stepName) => {
  const start = job.indexOf(`      - name: ${stepName}`);
  assert.notEqual(start, -1, `expected ${stepName} step`);
  const remainder = job.slice(start);
  const nextStep = remainder.slice(1).search(/^      - name:/m);
  return nextStep === -1 ? remainder : remainder.slice(0, nextStep + 1);
};

test('Android release workflow has one controlled release entry point', () => {
  const workflow = read('.github/workflows/android-release.yml');
  const jobs = workflow.slice(workflow.indexOf('\njobs:'));

  assert.equal((workflow.match(/tags:/g) || []).length, 1);
  assert.match(workflow, /push:\s*\n\s+tags:\s*\n\s+- ["']v\*["']/);
  assert.match(
    workflow,
    /workflow_dispatch:\s*\n\s+inputs:\s*\n\s+release_tag:[\s\S]*?required: true[\s\S]*?type: string/,
  );
  assert.match(
    workflow,
    /RELEASE_TAG: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.release_tag \|\| github\.ref_name \}\}/,
  );
  assert.equal((workflow.match(/group: android-release-publish/g) || []).length, 1);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /permissions:\s*\n\s+contents: read/);
  assert.doesNotMatch(workflow, /contents: write/);
  assert.match(workflow, /RELEASE_REPOSITORY: CircleTeamHub\/windnote-releases/);
  assert.deepEqual(
    [...jobs.matchAll(/^  ([a-z][a-z0-9-]*):\s*$/gm)].map((match) => match[1]),
    ['preflight', 'build', 'publish', 'notify'],
  );
});

test('Android release workflow preflight validates the exact public tag without secrets', () => {
  const workflow = read('.github/workflows/android-release.yml');
  const preflight = workflowJob(workflow, 'preflight');

  assert.doesNotMatch(preflight, /secrets\./);
  assert.match(preflight, /outputs:[\s\S]*release_tag:[\s\S]*commit_sha:/);
  assert.match(preflight, /ref: refs\/tags\/\$\{\{ env\.RELEASE_TAG \}\}/);
  assert.match(preflight, /fetch-depth: 0/);
  assert.match(preflight, /persist-credentials: false/);
  assert.match(preflight, /validate-android-release\.js metadata/);
  assert.match(preflight, /git rev-parse "refs\/tags\/\$RELEASE_TAG\^\{commit\}"/);
  assert.match(preflight, /test "\$\(git rev-parse HEAD\)" = "\$tag_commit"/);
  assert.match(preflight, /git merge-base --is-ancestor HEAD origin\/main/);
  assert.match(preflight, /release_tag=\$RELEASE_TAG.*GITHUB_OUTPUT/);
  assert.match(preflight, /commit_sha=\$tag_commit.*GITHUB_OUTPUT/);
  assert.match(preflight, /actions\/setup-node@/);
  assert.match(preflight, /run: npm ci/);
  assert.match(preflight, /run: npm run ci/);
  const validationIndex = preflight.indexOf(
    '- name: Validate release metadata and ancestry',
  );
  assert.ok(
    preflight.indexOf('- name: Setup Node') < validationIndex &&
      validationIndex < preflight.indexOf('- name: Install dependencies') &&
      validationIndex < preflight.indexOf('- name: Run application checks'),
    'metadata and ancestry validation must run after Node setup and before application work',
  );
});

test('Android release workflow builds and verifies a private signed artifact', () => {
  const workflow = read('.github/workflows/android-release.yml');
  const build = workflowJob(workflow, 'build');
  const signing = workflowStep(build, 'Validate signing configuration');

  assert.match(build, /needs: preflight/);
  assert.match(build, /ref: \$\{\{ needs\.preflight\.outputs\.commit_sha \}\}/);
  assert.match(build, /persist-credentials: false/);
  for (const name of [
    'ANDROID_KEYSTORE_BASE64',
    'ANDROID_KEYSTORE_PASSWORD',
    'ANDROID_KEY_ALIAS',
    'ANDROID_KEY_PASSWORD',
    'ANDROID_CERT_SHA256',
  ]) {
    assert.match(signing, new RegExp(`^          ${name}:`, 'm'));
  }
  assert.equal((signing.match(/^          [A-Z][A-Z0-9_]+:/gm) || []).length, 5);
  assert.match(signing, /validate-android-release\.js signing/);
  assert.doesNotMatch(build, /RELEASES_TOKEN/);
  assert.match(build, /actions\/setup-node@/);
  assert.ok(
    build.indexOf('- name: Setup Node') <
      build.indexOf('- name: Validate signing configuration'),
    'Node setup must run before signing validation',
  );
  assert.match(build, /actions\/setup-java@/);
  assert.match(build, /gradle\/actions\/setup-gradle@/);
  assert.match(build, /run: npm ci/);
  assert.match(build, /npx expo prebuild --platform android --clean --no-install/);
  assert.match(build, /RUNNER_TEMP\/android-signing/);
  assert.match(build, /chmod 600/);
  assert.match(build, /\.\/gradlew assembleRelease/);
  assert.match(build, /EXPO_PUBLIC_API_URL:/);
  assert.match(build, /EXPO_PUBLIC_OPENIM_API_URL:/);
  assert.match(build, /EXPO_PUBLIC_OPENIM_WS_URL:/);
  assert.match(build, /SENTRY_DISABLE_AUTO_UPLOAD: ["']true["']/);
  assert.match(build, /apksigner.*verify --verbose --print-certs/);
  assert.match(build, /ANDROID_CERT_SHA256/);
  assert.match(build, /windnote\.apk\.sha256/);
  assert.match(
    build,
    /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7\.0\.1/,
  );
});

test('Android release workflow protects promotion and reports observable results', () => {
  const workflow = read('.github/workflows/android-release.yml');
  const preflight = workflowJob(workflow, 'preflight');
  const build = workflowJob(workflow, 'build');
  const publish = workflowJob(workflow, 'publish');
  const notify = workflowJob(workflow, 'notify');
  const publisher = workflowStep(publish, 'Publish public GitHub release');
  const notification = workflowStep(notify, 'Notify Discord');

  assert.match(publish, /needs: \[preflight, build\]/);
  assert.match(publish, /if: \$\{\{ vars\.ANDROID_PUBLIC_RELEASE_ENABLED == 'true' \}\}/);
  assert.match(publish, /environment: android-release-publish/);
  assert.match(publish, /ref: \$\{\{ needs\.preflight\.outputs\.commit_sha \}\}/);
  assert.match(publish, /persist-credentials: false/);
  assert.match(
    publish,
    /actions\/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8\.0\.1/,
  );
  assert.match(publish, /sha256sum -c/);
  assert.match(publish, /ANDROID_PUBLIC_RELEASE_ENABLED: \$\{\{ vars\.ANDROID_PUBLIC_RELEASE_ENABLED \}\}/);
  assert.match(publish, /ANDROID_DISTRIBUTION_APPROVED: \$\{\{ vars\.ANDROID_DISTRIBUTION_APPROVED \}\}/);
  assert.match(publish, /ANDROID_DISTRIBUTION_EVIDENCE_URL: \$\{\{ vars\.ANDROID_DISTRIBUTION_EVIDENCE_URL \}\}/);
  assert.match(publish, /validate-android-release\.js distribution/);
  assert.match(
    publish,
    /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7\.0\.0/,
  );
  const publishNodeIndex = publish.indexOf('- name: Setup Node');
  assert.ok(
    publish.indexOf('- name: Checkout validated commit') < publishNodeIndex &&
      publishNodeIndex < publish.indexOf('validate-android-release.js distribution') &&
      publishNodeIndex < publish.indexOf('publish-android-release.js'),
    'publish Node setup must precede validator and publisher scripts',
  );
  assert.equal((workflow.match(/secrets\.RELEASES_TOKEN/g) || []).length, 1);
  assert.doesNotMatch(preflight, /RELEASES_TOKEN/);
  assert.doesNotMatch(build, /RELEASES_TOKEN/);
  assert.match(publisher, /GH_TOKEN: \$\{\{ secrets\.RELEASES_TOKEN \}\}/);
  assert.match(publisher, /RELEASE_TAG: \$\{\{ needs\.preflight\.outputs\.release_tag \}\}/);
  assert.match(publisher, /RELEASE_REPOSITORY: CircleTeamHub\/windnote-releases/);
  assert.match(publisher, /APK_PATH:/);
  assert.match(publisher, /node \.github\/scripts\/publish-android-release\.js/);
  for (const signingSecret of [
    'secrets.ANDROID_KEYSTORE_BASE64',
    'secrets.ANDROID_KEYSTORE_PASSWORD',
    'secrets.ANDROID_KEY_ALIAS',
    'secrets.ANDROID_KEY_PASSWORD',
  ]) {
    assert.doesNotMatch(`${preflight}\n${publish}\n${notify}`, new RegExp(signingSecret.replace('.', '\\.')));
  }

  assert.match(notify, /needs: \[preflight, build, publish\]/);
  assert.match(notify, /if: \$\{\{ always\(\) \}\}/);
  assert.match(notify, /needs\.preflight\.result/);
  assert.match(notify, /needs\.build\.result/);
  assert.match(notify, /needs\.publish\.result/);
  assert.match(notify, /github\.com\/\$\{\{ github\.repository \}\}\/actions\/runs\/\$\{\{ github\.run_id \}\}/);
  assert.match(notify, /github\.com\/CircleTeamHub\/windnote-releases\/releases\/tag/);
  assert.equal((workflow.match(/secrets\.DISCORD_WEBHOOK_URL/g) || []).length, 1);
  assert.match(notification, /DISCORD_WEBHOOK_URL: \$\{\{ secrets\.DISCORD_WEBHOOK_URL \}\}/);
  assert.match(notification, /-z "\$DISCORD_WEBHOOK_URL"/);
  assert.doesNotMatch(notify, /reject/i);
});

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
