const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
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

const fakeObjectPath = (stateDir, key) =>
  path.join(stateDir, `${Buffer.from(key).toString('base64url')}.json`);

const writeFakeObject = (stateDir, key, body, metadata = {}) => {
  fs.writeFileSync(
    fakeObjectPath(stateDir, key),
    JSON.stringify({
      body: Buffer.from(body).toString('base64'),
      metadata,
      cacheControl: 'public, max-age=300',
      contentType: 'application/vnd.android.package-archive',
    }),
  );
};

const readFakeObject = (stateDir, key) => {
  const file = fakeObjectPath(stateDir, key);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
};

const fakeObjectKeys = (stateDir) =>
  fs
    .readdirSync(stateDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) =>
      Buffer.from(name.slice(0, -'.json'.length), 'base64url').toString(),
    );

function createR2Harness({ hasLatest = true, prefix = 'preprod-r2-' } = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const stateDir = path.join(tempDir, 'r2');
  const binDir = path.join(tempDir, 'bin');
  fs.mkdirSync(stateDir);
  fs.mkdirSync(binDir);
  const fakeCli = path.join(
    process.cwd(),
    'test/helpers/fake-preprod-publish-cli.js',
  );
  for (const name of ['aws', 'curl', 'gh']) {
    fs.symlinkSync(fakeCli, path.join(binDir, name));
  }

  const candidate = Buffer.from('verified-preproduction-apk');
  const candidateSha = crypto.createHash('sha256').update(candidate).digest('hex');
  fs.writeFileSync(
    path.join(tempDir, 'windnote-preprod-v1.0.1.apk'),
    candidate,
  );
  fs.writeFileSync(
    path.join(tempDir, 'windnote-preprod-v1.0.1.apk.sha256'),
    `${candidateSha}  windnote-preprod-v1.0.1.apk\n`,
  );
  const oldLatest = Buffer.from('previous-preproduction-apk');
  if (hasLatest) {
    writeFakeObject(
      stateDir,
      'android/preprod/latest/windnote.apk',
      oldLatest,
      { sha256: crypto.createHash('sha256').update(oldLatest).digest('hex') },
    );
  }

  const sha = 'a'.repeat(40);
  const env = {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH}`,
    AWS_ACCESS_KEY_ID: 'fake',
    AWS_SECRET_ACCESS_KEY: 'fake',
    R2_ACCOUNT_ID: 'fake-account',
    R2_BUCKET: 'fake-bucket',
    R2_PUBLIC_APK_URL: 'https://downloads.example/preprod.apk',
    GITHUB_REPOSITORY: 'CircleTeamHub/Circle_frontend',
    GITHUB_SHA: sha,
    GITHUB_RUN_ID: '123',
    GITHUB_RUN_ATTEMPT: '1',
    RUNNER_TEMP: tempDir,
    FAKE_R2_DIR: stateDir,
  };
  return {
    candidate,
    candidateSha,
    env,
    oldLatest,
    sha,
    stateDir,
    tempDir,
  };
}

function runPublisher(options = {}) {
  const harness = createR2Harness({ ...options, prefix: 'preprod-publish-' });
  if (options.preexistingVersioned || options.legacyVersioned) {
    writeFakeObject(
      harness.stateDir,
      `android/preprod/builds/${harness.sha}/windnote.apk`,
      options.versionedBody ?? harness.candidate,
      {
        sha256: options.versionedSha ?? harness.candidateSha,
        ...(options.legacyVersioned
          ? {}
          : {
              package:
                options.versionedPackage ?? 'com.yiboding.circleim.preprod',
            }),
      },
    );
  }
  const result = spawnSync(
    'bash',
    [path.join(process.cwd(), '.github/scripts/publish-android-preprod.sh')],
    {
      cwd: harness.tempDir,
      encoding: 'utf8',
      env: {
        ...harness.env,
        ...(options.extraEnv ?? {}),
      },
    },
  );
  return { ...harness, result };
}

function runRollback(options = {}) {
  const harness = createR2Harness({ ...options, prefix: 'preprod-rollback-' });
  const rollbackSha = options.rollbackSha ?? 'c'.repeat(40);
  if (!options.missingVersioned) {
    writeFakeObject(
      harness.stateDir,
      `android/preprod/builds/${rollbackSha}/windnote.apk`,
      options.versionedBody ?? harness.candidate,
      {
        sha256: options.versionedSha ?? harness.candidateSha,
        ...(options.legacyVersioned
          ? {}
          : {
              package:
                options.versionedPackage ?? 'com.yiboding.circleim.preprod',
            }),
      },
    );
  }
  const result = spawnSync(
    'bash',
    [
      path.join(process.cwd(), '.github/scripts/rollback-android-preprod.sh'),
      rollbackSha,
    ],
    {
      cwd: harness.tempDir,
      encoding: 'utf8',
      env: {
        ...harness.env,
        FAKE_EXPECTED_COMPARE_SHA: rollbackSha,
        ...(options.extraEnv ?? {}),
      },
    },
  );
  return { ...harness, result, rollbackSha };
}

test('preproduction APK workflow builds on main or manually and queues verified runs', () => {
  const workflow = read(WORKFLOW_PATH);

  assert.match(
    workflow,
    /^on:\s*\n\s+push:\s*\n\s+branches:\s*\[main\]\s*\n\s+workflow_dispatch:\s*\n\s+inputs:\s*\n\s+rollback_sha:/m,
  );
  for (const forbiddenTrigger of ['pull_request', 'schedule']) {
    assert.doesNotMatch(workflow, new RegExp(`^\\s+${forbiddenTrigger}:`, 'm'));
  }
  assert.match(workflow, /permissions:\s*\n\s+contents: read/);
  assert.doesNotMatch(workflow, /contents: write/);
  assert.match(workflow, /group: android-preprod/);
  assert.match(workflow, /queue: max/);
  assert.doesNotMatch(workflow, /cancel-in-progress: true/);
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
  assert.match(
    publish,
    /github\.ref == 'refs\/heads\/main'.*inputs\.rollback_sha == ''.*vars\.ANDROID_PREPROD_PUBLIC_ENABLED == 'true'/,
  );
  assert.match(publish, /name: android-preprod-publish/);
  assert.doesNotMatch(build, /R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY|R2_ACCOUNT_ID/);
  const approval = workflowStep(
    publish,
    'Validate preproduction distribution approval',
  );
  for (const variable of [
    'ANDROID_PREPROD_PUBLIC_ENABLED',
    'ANDROID_PREPROD_DISTRIBUTION_APPROVED',
    'ANDROID_PREPROD_DISTRIBUTION_EVIDENCE_URL',
  ]) {
    assert.match(approval, new RegExp(`${variable}: \\$\\{\\{ vars\\.${variable} \\}\\}`));
  }
  assert.match(approval, /validate-android-release\.js preprod-distribution/);
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
  assert.match(upload, /GH_TOKEN: \$\{\{ github\.token \}\}/);
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
  assert.match(publisher, /Metadata\.package/);
  assert.match(publisher, /package=\$expected_package/);
  assert.match(publisher, /ContentLength/);
  assert.match(publisher, /\?build=\$GITHUB_SHA/);
  assert.match(publisher, /curl --fail --silent --show-error/);
  assert.match(publisher, /gh api .*git\/ref\/heads\/main.*--jq \.object\.sha/);
  assert.match(publisher, /current_main_sha.*!=.*GITHUB_SHA/);
  assert.ok(
    (publisher.match(/git\/ref\/heads\/main/g) || []).length >= 3,
    'main must be checked before promotion, after mutation, and after public verification',
  );
  const rollbackArmedAt = publisher.indexOf('promoted=true');
  const promoteAt = publisher.indexOf('aws s3api copy-object', rollbackArmedAt);
  assert.ok(
    rollbackArmedAt > -1 && rollbackArmedAt < promoteAt,
    'rollback must be armed before the latest alias is mutated',
  );
  const rollback = publisher.slice(
    publisher.indexOf('rollback_latest()'),
    publisher.indexOf('handle_exit()'),
  );
  assert.match(rollback, /--copy-source "\$R2_BUCKET\/\$rollback_key"/);
  assert.match(rollback, /--key "\$rollback_key"/);
  assert.match(rollback, /delete-object/);
  assert.ok(
    (publisher.match(/sha256sum -c/g) || []).length >= 3,
    'versioned, latest, and public APK bytes must each be hashed',
  );
});

test('manual preproduction rollback is gated and skips the build path', () => {
  const workflow = read(WORKFLOW_PATH);
  const build = workflowJob(workflow, 'build');
  const rollback = workflowJob(workflow, 'rollback');

  assert.match(workflow, /rollback_sha:/);
  assert.match(build, /inputs\.rollback_sha == ''/);
  assert.match(rollback, /github\.event_name == 'workflow_dispatch'/);
  assert.match(rollback, /github\.ref == 'refs\/heads\/main'/);
  assert.match(rollback, /inputs\.rollback_sha != ''/);
  assert.match(rollback, /vars\.ANDROID_PREPROD_PUBLIC_ENABLED == 'true'/);
  assert.match(rollback, /name: android-preprod-publish/);
  assert.match(
    workflowStep(rollback, 'Validate preproduction distribution approval'),
    /validate-android-release\.js preprod-distribution/,
  );
  assert.match(
    workflowStep(rollback, 'Restore verified preproduction APK'),
    /rollback-android-preprod\.sh "\$\{\{ inputs\.rollback_sha \}\}"/,
  );
  assert.match(
    workflowStep(rollback, 'Restore verified preproduction APK'),
    /GH_TOKEN: \$\{\{ github\.token \}\}/,
  );
});

test('manual preproduction rollback verifies source and restores failures safely', () => {
  const scenarios = [
    { name: 'successful rollback', expectedStatus: 0, expected: 'candidate' },
    {
      name: 'legacy metadata after identity cutover',
      expectedStatus: 0,
      expected: 'candidate',
      legacyVersioned: true,
    },
    {
      name: 'ambiguous rollback backup response',
      expectedStatus: 0,
      expected: 'candidate',
      extraEnv: { FAKE_FAIL_BACKUP: 'ambiguous' },
    },
    {
      name: 'ambiguous rollback promotion response',
      expectedStatus: 42,
      expected: 'old',
      extraEnv: { FAKE_FAIL_PROMOTE: 'ambiguous' },
    },
    {
      name: 'ambiguous first rollback promotion response',
      expectedStatus: 42,
      expected: 'missing',
      hasLatest: false,
      extraEnv: { FAKE_FAIL_PROMOTE: 'ambiguous' },
    },
    {
      name: 'public verification failure',
      expectedStatus: 1,
      expected: 'old',
      extraEnv: { FAKE_CORRUPT_PUBLIC: '1' },
    },
    {
      name: 'failed first rollback verification',
      expectedStatus: 1,
      expected: 'missing',
      hasLatest: false,
      extraEnv: { FAKE_CORRUPT_PUBLIC: '1' },
    },
  ];

  for (const scenario of scenarios) {
    const outcome = runRollback(scenario);
    try {
      assert.notEqual(
        outcome.rollbackSha,
        outcome.sha,
        'rollback target must differ from the workflow SHA',
      );
      assert.equal(
        outcome.result.status,
        scenario.expectedStatus,
        `${scenario.name}: ${outcome.result.stderr || outcome.result.stdout}`,
      );
      const latest = readFakeObject(
        outcome.stateDir,
        'android/preprod/latest/windnote.apk',
      );
      if (scenario.expected === 'missing') {
        assert.equal(latest, null, scenario.name);
      } else {
        assert.deepEqual(
          Buffer.from(latest.body, 'base64'),
          scenario.expected === 'candidate'
            ? outcome.candidate
            : outcome.oldLatest,
          scenario.name,
        );
      }
      if (scenario.expected === 'candidate') {
        assert.equal(latest.cacheControl, 'public, max-age=300');
        assert.equal(latest.metadata.package, 'com.yiboding.circleim.preprod');
      }
      assert.equal(
        fakeObjectKeys(outcome.stateDir).some((key) =>
          key.startsWith('android/preprod/rollback/'),
        ),
        false,
        `${scenario.name} must clean its rollback object`,
      );
    } finally {
      fs.rmSync(outcome.tempDir, { recursive: true, force: true });
    }
  }

  const restoreFailure = runRollback({
    extraEnv: { FAKE_CORRUPT_PUBLIC: '1', FAKE_FAIL_RESTORE: '1' },
  });
  try {
    assert.equal(restoreFailure.result.status, 1);
    assert.match(
      `${restoreFailure.result.stdout}\n${restoreFailure.result.stderr}`,
      /Failed to restore/,
    );
    assert.equal(
      fakeObjectKeys(restoreFailure.stateDir).some((key) =>
        key.startsWith('android/preprod/rollback/'),
      ),
      true,
      'failed restoration keeps its recovery object',
    );
  } finally {
    fs.rmSync(restoreFailure.tempDir, { recursive: true, force: true });
  }

  const invalidSha = runRollback({ rollbackSha: 'not-a-sha' });
  try {
    assert.equal(invalidSha.result.status, 2);
    assert.match(invalidSha.result.stderr, /40-character-main-sha/);
  } finally {
    fs.rmSync(invalidSha.tempDir, { recursive: true, force: true });
  }

  const preCutover = runRollback({
    legacyVersioned: true,
    extraEnv: { FAKE_GH_COMPARE_STATUS: 'behind' },
  });
  try {
    assert.equal(preCutover.result.status, 1);
    assert.match(
      `${preCutover.result.stdout}\n${preCutover.result.stderr}`,
      /identity cutover/,
    );
    assert.deepEqual(
      Buffer.from(
        readFakeObject(
          preCutover.stateDir,
          'android/preprod/latest/windnote.apk',
        ).body,
        'base64',
      ),
      preCutover.oldLatest,
    );
  } finally {
    fs.rmSync(preCutover.tempDir, { recursive: true, force: true });
  }

  const invalidSources = [
    { name: 'missing source', missingVersioned: true },
    { name: 'wrong package', versionedPackage: 'com.yiboding.circleim' },
    { name: 'invalid digest', versionedSha: 'not-a-digest' },
    { name: 'digest does not match bytes', versionedSha: 'b'.repeat(64) },
  ];
  for (const source of invalidSources) {
    const outcome = runRollback(source);
    try {
      assert.equal(outcome.result.status, 1, source.name);
      assert.deepEqual(
        Buffer.from(
          readFakeObject(
            outcome.stateDir,
            'android/preprod/latest/windnote.apk',
          ).body,
          'base64',
        ),
        outcome.oldLatest,
        source.name,
      );
      assert.equal(
        fakeObjectKeys(outcome.stateDir).some((key) =>
          key.startsWith('android/preprod/rollback/'),
        ),
        false,
        `${source.name} must fail before backup`,
      );
    } finally {
      fs.rmSync(outcome.tempDir, { recursive: true, force: true });
    }
  }
});

test('preproduction publisher restores latest across ambiguous and post-copy failures', () => {
  const cases = [
    { name: 'successful promotion', expectedStatus: 0, expected: 'candidate' },
    {
      name: 'matching preexisting versioned object',
      expectedStatus: 0,
      expected: 'candidate',
      preexistingVersioned: true,
    },
    {
      name: 'legacy versioned metadata after identity cutover',
      expectedStatus: 0,
      expected: 'candidate',
      legacyVersioned: true,
    },
    {
      name: 'legacy versioned metadata at identity cutover',
      expectedStatus: 0,
      expected: 'candidate',
      legacyVersioned: true,
      extraEnv: { FAKE_GH_COMPARE_STATUS: 'identical' },
    },
    {
      name: 'legacy versioned metadata before identity cutover',
      expectedStatus: 1,
      expected: 'old',
      legacyVersioned: true,
      extraEnv: { FAKE_GH_COMPARE_STATUS: 'behind' },
    },
    {
      name: 'ambiguous backup response',
      expectedStatus: 0,
      expected: 'candidate',
      extraEnv: { FAKE_FAIL_BACKUP: 'ambiguous' },
    },
    {
      name: 'ambiguous promotion response',
      expectedStatus: 42,
      expected: 'old',
      extraEnv: { FAKE_FAIL_PROMOTE: 'ambiguous' },
    },
    {
      name: 'public verification failure',
      expectedStatus: 1,
      expected: 'old',
      extraEnv: { FAKE_CORRUPT_PUBLIC: '1' },
    },
    {
      name: 'stale before promotion',
      expectedStatus: 1,
      expected: 'old',
      extraEnv: { FAKE_GH_SHAS: 'b'.repeat(40) },
    },
    {
      name: 'main advances during promotion',
      expectedStatus: 1,
      expected: 'old',
      extraEnv: { FAKE_GH_SHAS: `${'a'.repeat(40)},${'b'.repeat(40)}` },
    },
    {
      name: 'main advances during first promotion',
      expectedStatus: 1,
      expected: 'missing',
      hasLatest: false,
      extraEnv: { FAKE_GH_SHAS: `${'a'.repeat(40)},${'b'.repeat(40)}` },
    },
    {
      name: 'main advances during public verification',
      expectedStatus: 1,
      expected: 'old',
      extraEnv: {
        FAKE_GH_SHAS: `${'a'.repeat(40)},${'a'.repeat(40)},${'b'.repeat(40)}`,
      },
    },
    {
      name: 'ambiguous first promotion',
      expectedStatus: 42,
      expected: 'missing',
      hasLatest: false,
      extraEnv: { FAKE_FAIL_PROMOTE: 'ambiguous' },
    },
  ];

  for (const scenario of cases) {
    const outcome = runPublisher(scenario);
    try {
      assert.equal(
        outcome.result.status,
        scenario.expectedStatus,
        `${scenario.name}: ${outcome.result.stderr || outcome.result.stdout}`,
      );
      const latest = readFakeObject(
        outcome.stateDir,
        'android/preprod/latest/windnote.apk',
      );
      if (scenario.expected === 'missing') {
        assert.equal(latest, null, scenario.name);
      } else {
        const expectedBody =
          scenario.expected === 'candidate'
            ? outcome.candidate
            : outcome.oldLatest;
        assert.deepEqual(
          Buffer.from(latest.body, 'base64'),
          expectedBody,
          scenario.name,
        );
      }
      assert.equal(
        fakeObjectKeys(outcome.stateDir).some((key) =>
          key.startsWith('android/preprod/rollback/'),
        ),
        false,
        `${scenario.name} must clean its rollback object`,
      );
    } finally {
      fs.rmSync(outcome.tempDir, { recursive: true, force: true });
    }
  }

  const restoreFailure = runPublisher({
    extraEnv: {
      FAKE_CORRUPT_PUBLIC: '1',
      FAKE_FAIL_RESTORE: '1',
    },
  });
  try {
    assert.equal(restoreFailure.result.status, 1);
    assert.match(
      `${restoreFailure.result.stdout}\n${restoreFailure.result.stderr}`,
      /Failed to restore|Failed to roll back/,
    );
    assert.equal(
      fakeObjectKeys(restoreFailure.stateDir).some((key) =>
        key.startsWith('android/preprod/rollback/'),
      ),
      true,
      'failed restoration keeps its recovery object for incident handling',
    );
  } finally {
    fs.rmSync(restoreFailure.tempDir, { recursive: true, force: true });
  }

  const invalidExistingObjects = [
    {
      name: 'preexisting object with wrong bytes and size',
      preexistingVersioned: true,
      versionedBody: Buffer.from('wrong'),
    },
    {
      name: 'preexisting object with wrong digest',
      preexistingVersioned: true,
      versionedSha: 'b'.repeat(64),
    },
    {
      name: 'preexisting object with wrong package',
      preexistingVersioned: true,
      versionedPackage: 'com.yiboding.circleim',
    },
  ];
  for (const object of invalidExistingObjects) {
    const outcome = runPublisher(object);
    try {
      assert.equal(outcome.result.status, 1, object.name);
      assert.deepEqual(
        Buffer.from(
          readFakeObject(
            outcome.stateDir,
            'android/preprod/latest/windnote.apk',
          ).body,
          'base64',
        ),
        outcome.oldLatest,
        object.name,
      );
      assert.equal(
        fakeObjectKeys(outcome.stateDir).some((key) =>
          key.startsWith('android/preprod/rollback/'),
        ),
        false,
        `${object.name} must fail before backup`,
      );
    } finally {
      fs.rmSync(outcome.tempDir, { recursive: true, force: true });
    }
  }
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

test('preproduction distribution validator fails closed', () => {
  const {
    validatePreprodDistributionApproval,
  } = require('../.github/scripts/validate-android-release');
  const approval = {
    ANDROID_PREPROD_PUBLIC_ENABLED: 'true',
    ANDROID_PREPROD_DISTRIBUTION_APPROVED: 'true',
    ANDROID_PREPROD_DISTRIBUTION_EVIDENCE_URL:
      'https://github.com/CircleTeamHub/Circle_frontend/pull/181',
  };
  assert.deepEqual(validatePreprodDistributionApproval({ env: approval }), []);
  for (const variable of [
    'ANDROID_PREPROD_PUBLIC_ENABLED',
    'ANDROID_PREPROD_DISTRIBUTION_APPROVED',
  ]) {
    assert.match(
      validatePreprodDistributionApproval({
        env: { ...approval, [variable]: 'false' },
      }).join('\n'),
      new RegExp(`${variable} must be true`),
    );
  }
  assert.match(
    validatePreprodDistributionApproval({
      env: {
        ...approval,
        ANDROID_PREPROD_DISTRIBUTION_EVIDENCE_URL: 'http://example.com',
      },
    }).join('\n'),
    /must use https:/,
  );

  const runValidator = (scope, env) =>
    spawnSync(
      process.execPath,
      ['.github/scripts/validate-android-release.js', scope],
      { cwd: process.cwd(), env: { ...process.env, ...env }, encoding: 'utf8' },
    );
  const validApproval = runValidator('preprod-distribution', approval);
  assert.equal(validApproval.status, 0, validApproval.stderr);
  for (const invalidEnv of [
    { ...approval, ANDROID_PREPROD_DISTRIBUTION_APPROVED: 'false' },
    { ...approval, ANDROID_PREPROD_DISTRIBUTION_EVIDENCE_URL: '' },
    {
      ...approval,
      ANDROID_PREPROD_DISTRIBUTION_EVIDENCE_URL: 'http://example.com',
    },
  ]) {
    assert.equal(runValidator('preprod-distribution', invalidEnv).status, 1);
  }
});
