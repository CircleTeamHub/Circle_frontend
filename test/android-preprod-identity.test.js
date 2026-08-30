const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

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

test('preproduction workflow builds and verifies the isolated app variant', () => {
  const workflow = read('.github/workflows/android-preprod-build.yml');
  const build = workflowJob(workflow, 'build');
  const metadata = workflowStep(build, 'Validate preproduction metadata');
  const prebuild = workflowStep(build, 'Generate Android project');
  const gradle = workflowStep(build, 'Build signed preproduction APK');
  const manifest = workflowStep(
    build,
    'Verify generated preproduction deep links',
  );

  for (const step of [metadata, prebuild, gradle]) {
    assert.match(step, /APP_VARIANT: preprod/);
  }
  assert.match(
    manifest,
    /verify-android-preprod\.js manifest android\/app\/src\/main\/AndroidManifest\.xml/,
  );
  assert.match(workflow, /package: name='com\.yiboding\.circleim\.preprod'/);
  assert.match(
    workflow,
    /EXPO_PUBLIC_SENTRY_DSN: \$\{\{ vars\.EXPO_PUBLIC_SENTRY_DSN \}\}/,
  );
  assert.match(workflow, /validate-android-release\.js preprod-build-env/);
});

test('preproduction metadata CLI loads the dynamic app variant', () => {
  const { EXPECTED } = require('../.github/scripts/verify-android-preprod');
  const metadataEnv = {
    ...process.env,
    APP_VARIANT: 'preprod',
    EXPO_PUBLIC_API_URL: EXPECTED.apiUrl,
    EXPO_PUBLIC_CHAT_WS_URL: EXPECTED.apiUrl,
    EXPO_PUBLIC_MEDIA_ORIGINS: EXPECTED.mediaOrigin,
  };
  const run = (env) =>
    spawnSync(
      process.execPath,
      ['.github/scripts/verify-android-preprod.js', 'metadata'],
      { cwd: process.cwd(), env, encoding: 'utf8' },
    );

  const valid = run(metadataEnv);
  assert.equal(valid.status, 0, valid.stderr);

  const productionIdentity = run({ ...metadataEnv, APP_VARIANT: '' });
  assert.equal(productionIdentity.status, 1);
  assert.match(productionIdentity.stderr, /package.*preprod|variant.*preprod/i);
});

test('manifest CLI accepts Expo-generated preproduction schemes and rejects production schemes', () => {
  const os = require('node:os');
  const tempProject = fs.mkdtempSync(
    path.join(os.tmpdir(), 'preprod-expo-config-'),
  );
  try {
    for (const entry of [
      'app',
      'app.config.js',
      'app.json',
      'assets',
      'node_modules',
      'package.json',
      'plugins',
    ]) {
      fs.symlinkSync(path.join(process.cwd(), entry), path.join(tempProject, entry));
    }
    const introspection = spawnSync(
      process.execPath,
      [require.resolve('expo/bin/cli'), 'config', '--type', 'introspect', '--json'],
      {
        cwd: tempProject,
        env: { ...process.env, APP_VARIANT: 'preprod' },
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
      },
    );
    assert.equal(introspection.status, 0, introspection.stderr);
    const config = JSON.parse(introspection.stdout);
    const activities =
      config._internal.modResults.android.manifest.manifest.application[0]
        .activity;
    const schemes = activities.flatMap((activity) =>
      (activity['intent-filter'] ?? []).flatMap((filter) =>
        (filter.data ?? [])
          .map((entry) => entry.$?.['android:scheme'])
          .filter(Boolean),
      ),
    );
    assert.ok(schemes.includes('windnoteai-preprod'));
    assert.ok(schemes.includes('circleim-preprod'));
    assert.ok(!schemes.includes('windnoteai'));
    assert.ok(!schemes.includes('circleim'));

    const manifestPath = path.join(tempProject, 'AndroidManifest.xml');
    fs.writeFileSync(
      manifestPath,
      schemes.map((scheme) => `<data android:scheme="${scheme}"/>`).join(''),
    );
    const valid = spawnSync(
      process.execPath,
      ['.github/scripts/verify-android-preprod.js', 'manifest', manifestPath],
      { cwd: process.cwd(), encoding: 'utf8' },
    );
    assert.equal(valid.status, 0, valid.stderr);

    fs.writeFileSync(manifestPath, '<data android:scheme="windnoteai"/>');
    const invalid = spawnSync(
      process.execPath,
      ['.github/scripts/verify-android-preprod.js', 'manifest', manifestPath],
      { cwd: process.cwd(), encoding: 'utf8' },
    );
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /production scheme|missing preproduction scheme/i);
  } finally {
    fs.rmSync(tempProject, { recursive: true, force: true });
  }
});

test('preproduction build environment requires a valid runtime Sentry DSN', () => {
  const baseEnv = {
    ...process.env,
    EXPO_PUBLIC_API_URL: 'https://api.example.com',
    EXPO_PUBLIC_MEDIA_ORIGINS: 'https://media.example.com',
  };
  const run = (dsn) =>
    spawnSync(
      process.execPath,
      ['.github/scripts/validate-android-release.js', 'preprod-build-env'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...baseEnv, EXPO_PUBLIC_SENTRY_DSN: dsn },
      },
    );

  const valid = run('https://public@example.sentry.io/4507');
  assert.equal(valid.status, 0, valid.stderr);

  const missing = run('');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /EXPO_PUBLIC_SENTRY_DSN is required/);

  const malformed = run('not-a-dsn');
  assert.equal(malformed.status, 1);
  assert.match(malformed.stderr, /Sentry DSN URL/);
});
