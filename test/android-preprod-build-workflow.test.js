const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const WORKFLOW_PATH = '.github/workflows/android-preprod-build.yml';

const read = (relativePath) =>
  fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

const workflowJob = (workflow, jobName) => {
  const jobs = workflow.slice(workflow.indexOf('\njobs:'));
  const header = `\n  ${jobName}:`;
  const start = jobs.indexOf(header);
  assert.notEqual(start, -1, `expected ${jobName} job`);
  const remainder = jobs.slice(start + header.length);
  const nextJob = remainder.search(/^  [a-z][a-z0-9_-]*:\s*$/m);
  return nextJob === -1 ? remainder : remainder.slice(0, nextJob);
};

const workflowStep = (job, stepName) => {
  const start = job.indexOf(`      - name: ${stepName}`);
  assert.notEqual(start, -1, `expected ${stepName} step`);
  const remainder = job.slice(start);
  const nextStep = remainder.slice(1).search(/^      - name:/m);
  return nextStep === -1 ? remainder : remainder.slice(0, nextStep + 1);
};

test('preproduction APK workflow builds on main or manually and queues verified runs', () => {
  const workflow = read(WORKFLOW_PATH);

  assert.match(
    workflow,
    /^on:\s*\n\s+push:\s*\n\s+branches:\s*\[main\]\s*\n\s+workflow_dispatch:\s*$/m,
  );
  for (const forbiddenTrigger of ['pull_request', 'schedule']) {
    assert.doesNotMatch(workflow, new RegExp(`^\\s+${forbiddenTrigger}:`, 'm'));
  }
  assert.match(workflow, /permissions:\s*\n\s+contents: read/);
  assert.doesNotMatch(workflow, /contents: write/);
  assert.match(workflow, /group: android-preprod/);
  assert.match(workflow, /cancel-in-progress: false/);

  for (const forbidden of [
    'RELEASES_TOKEN',
    'publish-android-release.js',
    'windnote-releases',
    'gh release',
    'contents: write',
  ]) {
    assert.doesNotMatch(workflow, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('preproduction workflow publishes the verified artifact to an isolated R2 channel only from main', () => {
  const workflow = read(WORKFLOW_PATH);
  const build = workflowJob(workflow, 'build');
  const publish = workflowJob(workflow, 'publish');
  const download = workflowStep(publish, 'Download verified preproduction artifact');
  const upload = workflowStep(
    publish,
    'Publish verified preproduction APK to Cloudflare R2',
  );
  const publisher = read('.github/scripts/publish-android-preprod.sh');

  assert.match(publish, /needs: build/);
  assert.match(publish, /if: \$\{\{ github\.ref == 'refs\/heads\/main' \}\}/);
  assert.doesNotMatch(build, /R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY|R2_ACCOUNT_ID/);
  assert.match(
    download,
    /actions\/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8\.0\.1/,
  );
  assert.match(download, /name: android-preprod-v1\.0\.1/);
  assert.match(publish, /sha256sum -c windnote-preprod-v1\.0\.1\.apk\.sha256/);

  for (const credential of [
    'AWS_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}',
    'AWS_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}',
    'R2_ACCOUNT_ID: ${{ vars.R2_ACCOUNT_ID }}',
  ]) {
    assert.ok(upload.includes(credential), `publish step injects ${credential}`);
  }
  assert.match(upload, /publish-android-preprod\.sh/);
  assert.match(publisher, /android\/preprod\/builds\/\$\{GITHUB_SHA\}\/windnote\.apk/);
  assert.match(publisher, /android\/preprod\/latest\/windnote\.apk/);
  assert.doesNotMatch(workflow, /android\/latest\/windnote\.apk/);
  assert.match(publisher, /aws s3api put-object/);
  assert.match(publisher, /--if-none-match ['"]\*['"]/);
  assert.match(publisher, /aws s3api head-object/);
  assert.match(publisher, /aws s3api get-object/);
  assert.match(publisher, /aws s3api copy-object/);
  assert.match(publisher, /android\/preprod\/rollback\/\$\{GITHUB_RUN_ID\}-\$\{GITHUB_RUN_ATTEMPT\}\/windnote\.apk/);
  assert.match(publisher, /rollback_latest/);
  assert.match(publisher, /aws s3api delete-object/);
  assert.match(publisher, /--metadata-directive REPLACE/);
  assert.match(publisher, /application\/vnd\.android\.package-archive/);
  assert.match(publisher, /max-age=31536000, immutable/);
  assert.match(publisher, /max-age=300/);
  assert.match(publisher, /Metadata\.sha256/);
  assert.match(publisher, /ContentLength/);
  assert.match(publisher, /\?build=\$GITHUB_SHA/);
  assert.match(publisher, /curl --fail --silent --show-error/);
  assert.ok(
    (publisher.match(/sha256sum -c/g) || []).length >= 3,
    'versioned, latest, and public APK bytes must each be hashed',
  );
});

test('preproduction build runs checks before the signed release build', () => {
  const workflow = read(WORKFLOW_PATH);
  const build = workflowJob(workflow, 'build');

  for (const command of ['npm ci', 'npm run licenses:check', 'npm run ci']) {
    assert.match(build, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.ok(build.indexOf(command) < build.indexOf('./gradlew assembleRelease'));
  }
  assert.match(build, /npx expo prebuild --platform android --clean --no-install/);
  assert.match(build, /\.\/gradlew assembleRelease --no-daemon -PreactNativeArchitectures=arm64-v8a/);

  const gradle = workflowStep(build, 'Build signed preproduction APK');
  assert.match(gradle, /APP_VARIANT: preprod/);
  for (const name of [
    'ANDROID_KEYSTORE_PASSWORD',
    'ANDROID_KEY_ALIAS',
    'ANDROID_KEY_PASSWORD',
  ]) {
    assert.match(
      gradle,
      new RegExp(`${name}: \\$\\{\\{ secrets\\.${name} \\}\\}`),
    );
  }
  for (const name of [
    'EXPO_PUBLIC_API_URL',
    'EXPO_PUBLIC_CHAT_WS_URL',
    'EXPO_PUBLIC_MEDIA_ORIGINS',
  ]) {
    assert.match(
      gradle,
      new RegExp(`${name}: \\$\\{\\{ vars\\.${name} \\}\\}`),
    );
  }
  assert.match(gradle, /SENTRY_DISABLE_AUTO_UPLOAD: "true"/);

  const publicRelease = read('.github/workflows/android-release.yml');
  assert.doesNotMatch(publicRelease, /SENTRY_DISABLE_AUTO_UPLOAD: ["']true["']/);
});

test('preproduction build verifies signing, identity, version, and embedded endpoints', () => {
  const workflow = read(WORKFLOW_PATH);
  const build = workflowJob(workflow, 'build');

  const signing = workflowStep(build, 'Restore and verify signing key');
  assert.match(signing, /ANDROID_KEYSTORE_BASE64: \$\{\{ secrets\.ANDROID_KEYSTORE_BASE64 \}\}/);
  assert.match(signing, /base64 --decode/);
  assert.match(signing, /keytool -list -v/);
  assert.match(signing, /ANDROID_CERT_SHA256/);
  assert.match(signing, /actual_cert.*!=.*expected_cert/);

  const verify = workflowStep(build, 'Verify and stage preproduction APK');
  assert.match(verify, /apksigner.*verify --verbose --print-certs/);
  assert.match(verify, /aapt.*dump badging/);
  assert.match(verify, /com\.yiboding\.circleim\.preprod/);
  assert.match(verify, /versionCode='1000001'/);
  assert.match(verify, /versionName='1\.0\.1'/);
  assert.match(verify, /verify-android-preprod\.js apk/);
  assert.match(verify, /windnote-preprod-v1\.0\.1\.apk/);
  assert.match(verify, /sha256sum/);

  const cleanup = workflowStep(build, 'Remove signing material');
  assert.match(cleanup, /if: \$\{\{ always\(\) \}\}/);
  assert.match(cleanup, /rm -rf "\$RUNNER_TEMP\/android-signing"/);
});

test('preproduction artifact contains APK, digest, notices, and SBOM for 30 days', () => {
  const workflow = read(WORKFLOW_PATH);
  const build = workflowJob(workflow, 'build');
  const upload = workflowStep(build, 'Upload private preproduction artifact');

  assert.match(upload, /actions\/upload-artifact@/);
  assert.match(upload, /retention-days: 30/);
  assert.match(upload, /runner\.temp.*android-preprod-v1\.0\.1\//);
  assert.match(workflow, /windnote-preprod-v1\.0\.1\.apk/);
  assert.match(workflow, /windnote-preprod-v1\.0\.1\.apk\.sha256/);
  assert.match(workflow, /THIRD_PARTY_NOTICES\.txt/);
  assert.match(workflow, /cyclonedx-sbom\.json/);
  assert.match(upload, /if-no-files-found: error/);
});

test('preproduction package cutover requires retiring the old install', () => {
  const documentation = read('docs/android-release.md');

  assert.match(documentation, /one-time cutover/i);
  assert.match(documentation, /uninstall the old website APK/i);
  assert.match(documentation, /install `风信测试版`/i);
  assert.match(documentation, /sign in again/i);
  assert.match(documentation, /cannot migrate across Android package IDs/i);
  assert.match(documentation, /卸载旧测试版、安装风信测试版、重新登录/);
});

test('preproduction verifier fails closed for metadata and APK endpoint drift', () => {
  const {
    EXPECTED,
    validateApkContents,
    validateAndroidManifest,
    validateMetadata,
    verifyApk,
  } = require('../.github/scripts/verify-android-preprod');
  const app = {
    name: EXPECTED.appName,
    version: '1.0.1',
    extra: { appVariant: EXPECTED.appVariant },
    android: { versionCode: 1000001, package: EXPECTED.packageName },
  };
  const env = {
    EXPO_PUBLIC_API_URL: EXPECTED.apiUrl,
    EXPO_PUBLIC_CHAT_WS_URL: EXPECTED.apiUrl,
    EXPO_PUBLIC_MEDIA_ORIGINS: EXPECTED.mediaOrigin,
  };

  assert.deepEqual(validateMetadata({ app, env }), []);
  assert.match(
    validateMetadata({ app: { ...app, version: '1.0.0' }, env }).join('\n'),
    /version.*1\.0\.1/i,
  );
  assert.match(
    validateMetadata({ app: { ...app, extra: {} }, env }).join('\n'),
    /variant.*preprod/i,
  );
  assert.match(
    validateMetadata({
      app: {
        ...app,
        android: { ...app.android, package: 'com.yiboding.circleim' },
      },
      env,
    }).join('\n'),
    /package.*preprod/i,
  );
  assert.deepEqual(
    validateAndroidManifest(
      '<data android:scheme="windnoteai-preprod"/><data android:scheme="circleim-preprod"/>',
    ),
    [],
  );
  assert.match(
    validateAndroidManifest(
      '<data android:scheme="windnoteai"/><data android:scheme="circleim-preprod"/>',
    ).join('\n'),
    /production scheme|missing preproduction scheme/i,
  );
  assert.match(
    validateMetadata({ app, env: { ...env, EXPO_PUBLIC_API_URL: 'http://api.test' } }).join('\n'),
    /EXPO_PUBLIC_API_URL/,
  );

  const valid = Buffer.from(`${EXPECTED.apiHost}\n${EXPECTED.mediaHost}`);
  assert.deepEqual(validateApkContents(valid), []);
  assert.match(validateApkContents(Buffer.from(EXPECTED.apiHost)).join('\n'), /media/i);
  for (const forbidden of EXPECTED.forbiddenStrings) {
    assert.match(
      validateApkContents(Buffer.concat([valid, Buffer.from(`\n${forbidden}`)])).join('\n'),
      /forbidden/i,
    );
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'windnote-apk-check-'));
  const malformed = path.join(tempDir, 'malformed.apk');
  fs.writeFileSync(malformed, 'not an apk');
  try {
    assert.throws(
      () =>
        verifyApk(malformed, () => ({ status: 1, stderr: 'invalid archive' })),
      /not a valid ZIP archive/,
    );
    let call = 0;
    assert.throws(
      () =>
        verifyApk(malformed, () =>
          call++ === 0
            ? { status: 0, stdout: Buffer.alloc(0) }
            : { status: 0, stdout: Buffer.from(EXPECTED.apiHost) },
        ),
      /missing expected media host/,
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
