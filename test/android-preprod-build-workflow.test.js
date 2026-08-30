const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const WORKFLOW_PATH = '.github/workflows/android-preprod-build.yml';
const COS_PUBLISHER_PATH = '.github/scripts/publish-android-preprod-cos.sh';
const COS_ROLLBACK_PATH = '.github/scripts/rollback-android-preprod-cos.sh';
const EXPECTED_PACKAGE = 'com.yiboding.circleim.preprod';

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

const expectedCosMetadata = (sha, cacheControl) => ({
  'content-type': 'application/vnd.android.package-archive',
  'content-disposition': 'attachment; filename=windnote-preprod.apk',
  'cache-control': cacheControl,
  'x-cos-meta-sha256': sha,
  'x-cos-meta-package': EXPECTED_PACKAGE,
});

const assertStoredObject = (
  object,
  { body, acl, cacheControl, sha, label },
) => {
  assert.ok(object, `${label} must exist`);
  assert.deepEqual(Buffer.from(object.body, 'base64'), body, label);
  assert.equal(object.acl, acl, `${label} ACL`);
  assert.deepEqual(
    object.metadata,
    expectedCosMetadata(sha, cacheControl),
    `${label} metadata`,
  );
};

function writeFakeObject(
  stateDir,
  key,
  body,
  options = {},
) {
  const acl = options.acl ?? 'public-read';
  const cacheControl = options.cacheControl ?? 'public, max-age=300';
  const contentDisposition =
    options.contentDisposition ?? 'attachment; filename=windnote-preprod.apk';
  const contentType =
    options.contentType ?? 'application/vnd.android.package-archive';
  const packageName = Object.hasOwn(options, 'packageName')
    ? options.packageName
    : EXPECTED_PACKAGE;
  const sha =
    options.sha ?? crypto.createHash('sha256').update(body).digest('hex');
  fs.writeFileSync(
    fakeObjectPath(stateDir, key),
    JSON.stringify({
      body: Buffer.from(body).toString('base64'),
      metadata: {
        'content-type': contentType,
        'content-disposition': contentDisposition,
        'cache-control': cacheControl,
        'x-cos-meta-sha256': sha,
        ...(packageName === undefined
          ? {}
          : { 'x-cos-meta-package': packageName }),
      },
      acl,
    }),
  );
  return sha;
}

function createCosHarness({ hasLatest = true, prefix = 'cos-preprod-' } = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const stateDir = path.join(tempDir, 'cos');
  const binDir = path.join(tempDir, 'bin');
  fs.mkdirSync(stateDir);
  fs.mkdirSync(binDir);
  const fakeCli = path.join(
    process.cwd(),
    'test/helpers/fake-cos-publish-cli.js',
  );
  for (const name of ['coscli', 'curl', 'gh']) {
    fs.symlinkSync(fakeCli, path.join(binDir, name));
  }

  const candidate = Buffer.from('verified-tencent-preproduction-apk');
  const candidateSha = crypto.createHash('sha256').update(candidate).digest('hex');
  const apkPath = path.join(tempDir, 'windnote.apk');
  const checksumPath = path.join(tempDir, 'windnote.apk.sha256');
  fs.writeFileSync(apkPath, candidate);
  fs.writeFileSync(checksumPath, `${candidateSha}  windnote.apk\n`);

  const oldLatest = Buffer.from('previous-tencent-preproduction-apk');
  if (hasLatest) {
    writeFakeObject(
      stateDir,
      'android/preprod/latest/windnote.apk',
      oldLatest,
    );
  }

  const sha = 'a'.repeat(40);
  const env = {
    ...process.env,
    PATH: `${binDir}:${process.env.PATH}`,
    COSCLI_PATH: path.join(binDir, 'coscli'),
    COS_SECRET_ID: 'fake-id',
    COS_SECRET_KEY: 'fake-key',
    COS_BUCKET: 'fake-bucket',
    COS_ENDPOINT: 'cos.ap-tokyo.myqcloud.com',
    COS_KEY_PREFIX: 'android/preprod',
    COS_PUBLIC_APK_URL:
      'https://downloads.example.com/android/preprod/latest/windnote.apk',
    GH_TOKEN: 'fake-token',
    GITHUB_REPOSITORY: 'CircleTeamHub/Circle_frontend',
    GITHUB_SHA: sha,
    GITHUB_RUN_ID: '123',
    GITHUB_RUN_ATTEMPT: '1',
    RUNNER_TEMP: tempDir,
    FAKE_COS_DIR: stateDir,
  };
  return {
    apkPath,
    binDir,
    candidate,
    candidateSha,
    checksumPath,
    env,
    oldLatest,
    sha,
    stateDir,
    tempDir,
  };
}

function runCosPublisher(options = {}) {
  const harness = createCosHarness({ ...options, prefix: 'cos-publish-' });
  if (options.preexistingVersioned || options.legacyVersioned) {
    writeFakeObject(
      harness.stateDir,
      `android/preprod/builds/${harness.sha}/windnote.apk`,
      options.versionedBody ?? harness.candidate,
      {
        acl: 'private',
        cacheControl:
          options.versionedCacheControl ??
          'public, max-age=31536000, immutable',
        contentDisposition: options.versionedContentDisposition,
        contentType: options.versionedContentType,
        packageName: options.legacyVersioned
          ? undefined
          : (options.versionedPackage ?? EXPECTED_PACKAGE),
        sha: options.versionedSha ?? harness.candidateSha,
      },
    );
  }
  const result = spawnSync(
    'bash',
    [
      path.join(
        process.cwd(),
        '.github/scripts/publish-android-preprod-cos.sh',
      ),
      harness.apkPath,
      harness.checksumPath,
    ],
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
  const harness = createCosHarness({ ...options, prefix: 'cos-rollback-' });
  const rollbackSha = options.rollbackSha ?? 'c'.repeat(40);
  if (!options.missingVersioned) {
    writeFakeObject(
      harness.stateDir,
      `android/preprod/builds/${rollbackSha}/windnote.apk`,
      options.versionedBody ?? harness.candidate,
      {
        acl: 'private',
        cacheControl:
          options.versionedCacheControl ??
          'public, max-age=31536000, immutable',
        contentDisposition: options.versionedContentDisposition,
        contentType: options.versionedContentType,
        packageName: options.legacyVersioned
          ? undefined
          : (options.versionedPackage ?? EXPECTED_PACKAGE),
        sha: options.versionedSha ?? harness.candidateSha,
      },
    );
  }
  const result = spawnSync(
    'bash',
    [
      path.join(process.cwd(), COS_ROLLBACK_PATH),
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

test('preproduction workflow publishes the verified artifact to Tencent COS only from main', () => {
  const workflow = read(WORKFLOW_PATH);
  const build = workflowJob(workflow, 'build');
  const publish = workflowJob(workflow, 'publish');
  const checkout = workflowStep(publish, 'Checkout publishing policy');
  const download = workflowStep(publish, 'Download verified preproduction artifact');
  const install = workflowStep(publish, 'Install verified Tencent COSCLI');
  const upload = workflowStep(
    publish,
    'Publish verified preproduction APK to Tencent COS',
  );
  const publisher = read(COS_PUBLISHER_PATH);

  assert.match(publish, /needs: build/);
  assert.match(
    publish,
    /github\.ref == 'refs\/heads\/main'.*inputs\.rollback_sha == ''.*vars\.ANDROID_PREPROD_PUBLIC_ENABLED == 'true'/,
  );
  assert.match(publish, /name: android-preprod-publish/);
  assert.match(
    publish,
    /url: \$\{\{ vars\.TENCENT_COS_PUBLIC_APK_URL \}\}/,
  );
  assert.match(checkout, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(checkout, /persist-credentials: false/);
  assert.doesNotMatch(
    build,
    /TENCENT_COS_SECRET_ID|TENCENT_COS_SECRET_KEY|R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY|R2_ACCOUNT_ID/,
  );
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
    'COS_SECRET_ID: ${{ secrets.TENCENT_COS_SECRET_ID }}',
    'COS_SECRET_KEY: ${{ secrets.TENCENT_COS_SECRET_KEY }}',
  ]) {
    assert.ok(upload.includes(credential), `publish step injects ${credential}`);
  }
  assert.match(
    install,
    /https:\/\/github\.com\/tencentyun\/coscli\/releases\/download\/v1\.0\.8\/coscli-v1\.0\.8-linux-amd64/,
  );
  assert.match(
    install,
    /7165f2ae16c5f7ac495864c963ca574a76e04ec72680d7bc8a8eee3234d8cf91/,
  );
  assert.match(install, /sha256sum -c/);
  assert.match(install, /coscli version v1\.0\.8/);
  assert.match(upload, /COS_BUCKET: windnote-preprod-tokyo-1447743949/);
  assert.match(upload, /COS_ENDPOINT: cos\.ap-tokyo\.myqcloud\.com/);
  assert.match(upload, /COS_KEY_PREFIX: android\/preprod/);
  assert.match(
    upload,
    /COS_PUBLIC_APK_URL: \$\{\{ vars\.TENCENT_COS_PUBLIC_APK_URL \}\}/,
  );
  assert.match(upload, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(upload, /publish-android-preprod-cos\.sh/);

  for (const forbidden of [
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_ACCOUNT_ID',
    'r2.dev',
    'r2.cloudflarestorage.com',
    'aws s3api',
  ]) {
    assert.doesNotMatch(workflow, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  assert.match(publisher, /\$\{COS_KEY_PREFIX\}\/builds\/\$\{GITHUB_SHA\}\/windnote\.apk/);
  assert.match(publisher, /\$\{COS_KEY_PREFIX\}\/latest\/windnote\.apk/);
  assert.doesNotMatch(publisher, /android\/latest\/windnote\.apk/);
  assert.match(publisher, /--forbid-overwrite=true/);
  assert.match(publisher, /--bucket-type COS/);
  assert.match(publisher, /--acl private/);
  assert.match(publisher, /--acl public-read/);
  assert.doesNotMatch(publisher, /\bcos stat\b/);
  assert.match(publisher, /cos signurl/);
  assert.match(publisher, /--simple-output/);
  assert.match(publisher, /--range 0-0/);
  assert.match(publisher, /\bx-cos-meta-sha256:/);
  assert.match(publisher, /\bx-cos-meta-package:/);
  assert.match(publisher, /\$\{COS_KEY_PREFIX\}\/rollback\/\$\{GITHUB_RUN_ID\}-\$\{GITHUB_RUN_ATTEMPT\}\/windnote\.apk/);
  assert.match(publisher, /rollback_latest/);
  assert.match(publisher, /application\/vnd\.android\.package-archive/);
  assert.match(publisher, /max-age=31536000, immutable/);
  assert.match(publisher, /max-age=300/);
  assert.match(publisher, /\?verification=\$nonce/);
  assert.match(publisher, /curl --fail --silent --show-error/);
  assert.match(publisher, /verify_object "\$versioned_key"/);
  assert.match(publisher, /verify_object "\$latest_key"/);
  assert.match(publisher, /gh api .*git\/ref\/heads\/main.*--jq \.object\.sha/);
  assert.ok((publisher.match(/assert_current_main/g) || []).length >= 3);
  assert.doesNotMatch(
    publisher,
    /https:\/\/[^\s"']*\.myqcloud\.com\/android\/preprod\/latest\/windnote\.apk/,
  );
  const rollbackArmedAt = publisher.indexOf('rollback_armed=true');
  const promotionAt = publisher.indexOf(
    'cos cp "cos://$COS_BUCKET/$versioned_key" "cos://$COS_BUCKET/$latest_key"',
  );
  assert.ok(
    rollbackArmedAt > -1 && rollbackArmedAt < promotionAt,
    'rollback must be armed before latest is mutated',
  );
  assert.ok((publisher.match(/sha256sum -c/g) || []).length >= 2);
});

test('Tencent COS scripts reject unsafe public APK URLs before mutation', () => {
  const invalidUrls = [
    {
      name: 'default COS APK domain',
      url: 'https://fake-bucket.cos.ap-tokyo.myqcloud.com/android/preprod/latest/windnote.apk',
      error: /default domains cannot distribute APK/,
    },
    {
      name: 'insecure HTTP URL',
      url: 'http://downloads.example.com/android/preprod/latest/windnote.apk',
      error: /credential-free custom HTTPS URL/,
    },
    {
      name: 'wrong stable object path',
      url: 'https://downloads.example.com/android/preprod/builds/windnote.apk',
      error: /credential-free custom HTTPS URL/,
    },
    {
      name: 'credential-bearing URL',
      url: 'https://user@downloads.example.com/android/preprod/latest/windnote.apk',
      error: /must not contain credentials/,
    },
    {
      name: 'URL with query',
      url: 'https://downloads.example.com/android/preprod/latest/windnote.apk?token=secret',
      error: /credential-free custom HTTPS URL|must not contain credentials/,
    },
    {
      name: 'URL with fragment',
      url: 'https://downloads.example.com/android/preprod/latest/windnote.apk#download',
      error: /credential-free custom HTTPS URL|must not contain credentials/,
    },
  ];
  const runners = [
    { name: 'publisher', run: runCosPublisher },
    { name: 'rollback', run: runRollback },
  ];

  for (const runner of runners) {
    for (const invalid of invalidUrls) {
      const outcome = runner.run({
        extraEnv: { COS_PUBLIC_APK_URL: invalid.url },
      });
      try {
        const label = `${runner.name}: ${invalid.name}`;
        assert.equal(outcome.result.status, 1, label);
        assert.match(
          `${outcome.result.stdout}\n${outcome.result.stderr}`,
          invalid.error,
          label,
        );
        assert.deepEqual(
          Buffer.from(
            readFakeObject(
              outcome.stateDir,
              'android/preprod/latest/windnote.apk',
            ).body,
            'base64',
          ),
          outcome.oldLatest,
          `${label} must not mutate latest`,
        );
        assert.equal(
          fakeObjectKeys(outcome.stateDir).some((key) =>
            key.startsWith('android/preprod/rollback/'),
          ),
          false,
          `${label} must not create a recovery object`,
        );
        if (runner.name === 'publisher') {
          assert.equal(
            readFakeObject(
              outcome.stateDir,
              `android/preprod/builds/${outcome.sha}/windnote.apk`,
            ),
            null,
            `${label} must fail before versioned upload`,
          );
        }
      } finally {
        fs.rmSync(outcome.tempDir, { recursive: true, force: true });
      }
    }
  }
});

test('manual preproduction rollback is gated and skips the build path', () => {
  const workflow = read(WORKFLOW_PATH);
  const build = workflowJob(workflow, 'build');
  const rollback = workflowJob(workflow, 'rollback');
  const install = workflowStep(rollback, 'Install verified Tencent COSCLI');
  const restore = workflowStep(rollback, 'Restore verified preproduction APK');

  assert.match(workflow, /rollback_sha:/);
  assert.match(build, /inputs\.rollback_sha == ''/);
  assert.match(rollback, /github\.event_name == 'workflow_dispatch'/);
  assert.match(rollback, /github\.ref == 'refs\/heads\/main'/);
  assert.match(rollback, /inputs\.rollback_sha != ''/);
  assert.match(rollback, /vars\.ANDROID_PREPROD_PUBLIC_ENABLED == 'true'/);
  assert.match(rollback, /name: android-preprod-publish/);
  assert.match(
    rollback,
    /url: \$\{\{ vars\.TENCENT_COS_PUBLIC_APK_URL \}\}/,
  );
  assert.match(
    workflowStep(rollback, 'Validate preproduction distribution approval'),
    /validate-android-release\.js preprod-distribution/,
  );
  assert.match(
    restore,
    /rollback-android-preprod-cos\.sh "\$\{\{ inputs\.rollback_sha \}\}"/,
  );
  assert.match(
    install,
    /https:\/\/github\.com\/tencentyun\/coscli\/releases\/download\/v1\.0\.8\/coscli-v1\.0\.8-linux-amd64/,
  );
  assert.match(
    install,
    /7165f2ae16c5f7ac495864c963ca574a76e04ec72680d7bc8a8eee3234d8cf91/,
  );
  assert.match(install, /sha256sum -c/);
  assert.match(install, /coscli version v1\.0\.8/);
  for (const binding of [
    'COSCLI_PATH: ${{ runner.temp }}/coscli-v1.0.8',
    'COS_SECRET_ID: ${{ secrets.TENCENT_COS_SECRET_ID }}',
    'COS_SECRET_KEY: ${{ secrets.TENCENT_COS_SECRET_KEY }}',
    'COS_BUCKET: windnote-preprod-tokyo-1447743949',
    'COS_ENDPOINT: cos.ap-tokyo.myqcloud.com',
    'COS_KEY_PREFIX: android/preprod',
    'COS_PUBLIC_APK_URL: ${{ vars.TENCENT_COS_PUBLIC_APK_URL }}',
    'GH_TOKEN: ${{ github.token }}',
  ]) {
    assert.ok(restore.includes(binding), `rollback step injects ${binding}`);
  }
});

test('manual preproduction rollback verifies source and restores failures safely', () => {
  const scenarios = [
    { name: 'successful rollback', expectedStatus: 0, expected: 'candidate' },
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
    {
      name: 'stale workflow before rollback mutation',
      expectedStatus: 1,
      expected: 'old',
      extraEnv: { FAKE_GH_SHAS: 'b'.repeat(40) },
    },
    {
      name: 'main advances during rollback promotion',
      expectedStatus: 1,
      expected: 'old',
      extraEnv: { FAKE_GH_SHAS: `${'a'.repeat(40)},${'b'.repeat(40)}` },
    },
    {
      name: 'main advances during first rollback promotion',
      expectedStatus: 1,
      expected: 'missing',
      hasLatest: false,
      extraEnv: { FAKE_GH_SHAS: `${'a'.repeat(40)},${'b'.repeat(40)}` },
    },
    {
      name: 'main advances during rollback public verification',
      expectedStatus: 1,
      expected: 'old',
      extraEnv: {
        FAKE_GH_SHAS: `${'a'.repeat(40)},${'a'.repeat(40)},${'b'.repeat(40)}`,
      },
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
        assert.equal(latest.metadata['cache-control'], 'public, max-age=300');
        assert.equal(latest.metadata['x-cos-meta-package'], EXPECTED_PACKAGE);
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
    const recoveryKey = fakeObjectKeys(restoreFailure.stateDir).find((key) =>
      key.startsWith('android/preprod/rollback/'),
    );
    assert.ok(recoveryKey, 'failed manual rollback keeps its recovery object');
    assertStoredObject(
      readFakeObject(restoreFailure.stateDir, recoveryKey),
      {
        body: restoreFailure.oldLatest,
        acl: 'private',
        cacheControl: 'public, max-age=300',
        sha: crypto
          .createHash('sha256')
          .update(restoreFailure.oldLatest)
          .digest('hex'),
        label: 'failed manual rollback recovery object',
      },
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
    { name: 'missing package attestation', legacyVersioned: true },
    { name: 'invalid digest', versionedSha: 'not-a-digest' },
    { name: 'digest does not match bytes', versionedSha: 'b'.repeat(64) },
    {
      name: 'wrong immutable cache policy',
      versionedCacheControl: 'public, max-age=300',
    },
    {
      name: 'wrong content type',
      versionedContentType: 'application/octet-stream',
    },
    {
      name: 'wrong content disposition',
      versionedContentDisposition: 'inline',
    },
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

test('Tencent COS publisher restores bytes and headers across failed promotions', () => {
  const cases = [
    { name: 'successful promotion', expectedStatus: 0, expected: 'candidate' },
    {
      name: 'matching preexisting versioned object',
      expectedStatus: 0,
      expected: 'candidate',
      preexistingVersioned: true,
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
    const outcome = runCosPublisher(scenario);
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
        const expectedSha = crypto
          .createHash('sha256')
          .update(expectedBody)
          .digest('hex');
        assert.deepEqual(Buffer.from(latest.body, 'base64'), expectedBody, scenario.name);
        assert.equal(latest.acl, 'public-read', scenario.name);
        assert.deepEqual(
          latest.metadata,
          {
            'content-type': 'application/vnd.android.package-archive',
            'content-disposition': 'attachment; filename=windnote-preprod.apk',
            'cache-control': 'public, max-age=300',
            'x-cos-meta-sha256': expectedSha,
            'x-cos-meta-package': EXPECTED_PACKAGE,
          },
          scenario.name,
        );
      }
      assertStoredObject(
        readFakeObject(
          outcome.stateDir,
          `android/preprod/builds/${outcome.sha}/windnote.apk`,
        ),
        {
          body: outcome.candidate,
          acl: 'private',
          cacheControl: 'public, max-age=31536000, immutable',
          sha: outcome.candidateSha,
          label: `${scenario.name} versioned object`,
        },
      );
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

  const restoreFailure = runCosPublisher({
    extraEnv: {
      FAKE_CORRUPT_PUBLIC: '1',
      FAKE_FAIL_RESTORE: '1',
    },
  });
  try {
    assert.equal(restoreFailure.result.status, 1);
    assert.match(
      `${restoreFailure.result.stdout}\n${restoreFailure.result.stderr}`,
      /Failed to fully verify.*rollback/,
    );
    const recoveryKey = fakeObjectKeys(restoreFailure.stateDir).find((key) =>
      key.startsWith('android/preprod/rollback/'),
    );
    assert.ok(recoveryKey, 'failed restoration keeps its recovery object');
    assertStoredObject(
      readFakeObject(restoreFailure.stateDir, recoveryKey),
      {
        body: restoreFailure.oldLatest,
        acl: 'private',
        cacheControl: 'public, max-age=300',
        sha: crypto
          .createHash('sha256')
          .update(restoreFailure.oldLatest)
          .digest('hex'),
        label: 'failed publisher recovery object',
      },
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
    {
      name: 'preexisting object without package attestation',
      legacyVersioned: true,
    },
    {
      name: 'preexisting object with wrong immutable cache policy',
      preexistingVersioned: true,
      versionedCacheControl: 'public, max-age=300',
    },
    {
      name: 'preexisting object with wrong content type',
      preexistingVersioned: true,
      versionedContentType: 'application/octet-stream',
    },
    {
      name: 'preexisting object with wrong content disposition',
      preexistingVersioned: true,
      versionedContentDisposition: 'inline',
    },
  ];
  for (const object of invalidExistingObjects) {
    const outcome = runCosPublisher(object);
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
  assert.match(documentation, /mandatory rollback checkpoint/i);
  assert.match(
    documentation,
    /7cb7cb9f4e6f29fb5d6d3f6cb326d5d1338403a7/,
  );
  assert.match(
    documentation,
    /4e31cb02949f838e372e469f2b9ad28bba11fc58b32b305bf0f56f1435237253/,
  );
  assert.match(documentation, /private immutable object/i);
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
