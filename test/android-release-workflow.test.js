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

test('release rollout documentation records the fail-closed operating contract', () => {
  const documentation = read('docs/android-release.md');

  assert.match(documentation, /PR #57/);
  assert.match(documentation, /\.github\/workflows\/android-release\.yml/);
  assert.match(documentation, /only canonical workflow/i);
  assert.match(documentation, /PR #56[^\n]*(?:must not|do not) merge/i);
  assert.match(
    documentation,
    /secret-free preflight[\s\S]*signed[\s\S]*certificate[\s\S]*private artifact[\s\S]*30 days[\s\S]*default-disabled[\s\S]*protected promotion[\s\S]*best-effort Discord/i,
  );

  for (const repositoryVariable of [
    'EXPO_PUBLIC_API_URL',
    'ANDROID_CERT_SHA256',
  ]) {
    assert.match(
      documentation,
      new RegExp(`repository[^\\n]*${repositoryVariable}`, 'i'),
    );
  }
  for (const repositorySecret of [
    'ANDROID_KEYSTORE_BASE64',
    'ANDROID_KEYSTORE_PASSWORD',
    'ANDROID_KEY_ALIAS',
    'ANDROID_KEY_PASSWORD',
  ]) {
    assert.match(
      documentation,
      new RegExp(`repository[^\\n]*${repositorySecret}`, 'i'),
    );
  }
  assert.match(
    documentation,
    /RELEASES_TOKEN[^\n]*(?:must not|never)[^\n]*repository/i,
  );

  assert.match(documentation, /CircleTeamHub[^\n]*GitHub Free/i);
  assert.match(documentation, /Circle_frontend[^\n]*private/i);
  assert.match(documentation, /required reviewers[^\n]*unavailable/i);
  assert.match(documentation, /environment secrets[^\n]*unavailable/i);
  assert.match(
    documentation,
    /ANDROID_PUBLIC_RELEASE_ENABLED[^\n]*(?:absent|false)/i,
  );
  assert.match(documentation, /public promotion[^\n]*unavailable/i);
  assert.match(documentation, /(?:do not|never)[^\n]*repo(?:sitory)? token/i);

  assert.match(
    documentation,
    /Enterprise[^\n]*required reviewers[^\n]*private repo/i,
  );
  assert.match(documentation, /deliberate visibility decision/i);
  assert.match(documentation, /android-release-publish/);
  assert.match(documentation, /prevent self-review/i);
  assert.match(documentation, /deployment[^\n]*(?:tag|branch)[^\n]*policy/i);
  assert.match(documentation, /environment-only[^\n]*RELEASES_TOKEN/i);
  assert.match(documentation, /ANDROID_DISTRIBUTION_APPROVED=true/);
  assert.match(
    documentation,
    /ANDROID_DISTRIBUTION_EVIDENCE_URL[^\n]*HTTPS/i,
  );

  for (const command of [
    "gh api orgs/CircleTeamHub --jq '.plan.name'",
    "gh api repos/CircleTeamHub/Circle_frontend --jq '.visibility'",
    'gh secret list --repo CircleTeamHub/Circle_frontend',
    'gh api repos/CircleTeamHub/Circle_frontend/environments/android-release-publish',
    'gh api repos/CircleTeamHub/Circle_frontend/environments/android-release-publish/deployment-branch-policies',
  ]) {
    assert.ok(
      documentation.includes(command),
      `expected verification command: ${command}`,
    );
  }
  assert.match(documentation, /404[^\n]*(?:do not|must not)[^\n]*enable/i);

  for (const evidenceTerm of [
    'SBOM',
    'dependency list',
    'LICENSE',
    'NOTICE',
    'patch list',
    'qualified legal',
    'written decision',
    'build SHA',
    'vendor authorization',
  ]) {
    assert.match(documentation, new RegExp(evidenceTerm, 'i'));
  }

  assert.match(documentation, /app\.json[^\n]*version[^\n]*versionCode/i);
  assert.match(
    documentation,
    /versionCode\s*=\s*major\s*\*\s*1,?000,?000\s*\+\s*minor\s*\*\s*1,?000\s*\+\s*patch/i,
  );
  assert.match(documentation, /strict stable semver/i);
  assert.match(documentation, /tag[^\n]*commit[^\n]*main/i);
  assert.match(documentation, /push[^\n]*v\*/i);
  assert.match(documentation, /manual[^\n]*existing tag/i);
  const newReleaseTrigger = documentation.match(
    /### New release[^\n]*\n([\s\S]*?)(?=\n### )/i,
  );
  const existingTagRerun = documentation.match(
    /### Existing tag rerun[^\n]*\n([\s\S]*?)(?=\n## |$)/i,
  );
  assert.ok(newReleaseTrigger, 'expected a separate new-release trigger path');
  assert.ok(existingTagRerun, 'expected a separate existing-tag rerun path');
  assert.match(newReleaseTrigger[1], /git push origin v1\.2\.3/);
  assert.doesNotMatch(newReleaseTrigger[1], /gh workflow run/);
  assert.match(
    existingTagRerun[1],
    /gh workflow run \.github\/workflows\/android-release\.yml --ref v1\.2\.3 -f release_tag=v1\.2\.3/,
  );
  assert.doesNotMatch(existingTagRerun[1], /git push origin/);
  assert.match(documentation, /choose exactly one[^\n]*trigger path/i);
  assert.match(documentation, /immutable[^\n]*digest/i);

  assert.match(documentation, /Actions[^\n]*(?:jobs|results)/i);
  assert.match(documentation, /certificate fingerprint/i);
  assert.match(documentation, /artifact checksum/i);
  assert.match(documentation, /APK[^\n]*install/i);
  assert.match(documentation, /backend connectivity/i);
  assert.match(documentation, /legally permitted/i);
  assert.match(
    documentation,
    /disable[^\n]*ANDROID_PUBLIC_RELEASE_ENABLED/i,
  );
  assert.match(
    documentation,
    /never[^\n]*(?:overwrite|move)[^\n]*published tag/i,
  );
  assert.match(documentation, /new higher semver/i);
  assert.match(documentation, /keystore[^\n]*backup/i);
});

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
  assert.match(
    preflight,
    /EXPO_PUBLIC_MEMBERSHIP_SUPPORT_USER_ID: \$\{\{ vars\.EXPO_PUBLIC_MEMBERSHIP_SUPPORT_USER_ID \}\}/,
  );
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
  const signingKeyVerification = workflowStep(
    build,
    'Verify restored signing key',
  );
  const apkVerification = workflowStep(build, 'Verify and stage APK');
  const upload = workflowStep(build, 'Upload private release artifact');

  assert.match(build, /needs: preflight/);
  assert.match(build, /timeout-minutes: 60/);
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
  assert.match(signingKeyVerification, /keytool -list -v/);
  assert.match(signingKeyVerification, /ANDROID_KEYSTORE_PATH/);
  assert.match(signingKeyVerification, /ANDROID_CERT_SHA256/);
  assert.match(signingKeyVerification, /tr -d '\[:space:\]:'/);
  assert.match(
    build,
    /\.\/gradlew assembleRelease --no-daemon -PreactNativeArchitectures=arm64-v8a/,
  );
  // ABI 收窄只作用于 release 打包(靠上面的 gradlew flag)。不再用 config plugin 往
  // 生成的 gradle.properties 全局写死 arm64——否则 Intel 主机上的 x86_64 模拟器 debug
  // 构建会缺 native 库、装上跑不起来。
  assert.doesNotMatch(read('app.json'), /with-android-abi-filter/);
  assert.match(build, /EXPO_PUBLIC_API_URL:/);

  assert.match(
    build,
    /EXPO_PUBLIC_MEMBERSHIP_SUPPORT_USER_ID: \$\{\{ vars\.EXPO_PUBLIC_MEMBERSHIP_SUPPORT_USER_ID \}\}/,
  );
  // 客服中心各入口的专属账号必须注入构建环境，否则 support-categories.ts 编译期
  // 回落到 imAdmin，生产用户被导去系统管理员而非对应真人客服（评审 P2）。
  for (const supportVar of [
    'EXPO_PUBLIC_SUPPORT_ACCOUNT_ID',
    'EXPO_PUBLIC_SUPPORT_RECHARGE_ID',
    'EXPO_PUBLIC_SUPPORT_ISSUE_ID',
    'EXPO_PUBLIC_SUPPORT_DISPUTE_ID',
    'EXPO_PUBLIC_SUPPORT_ACCOUNT_AGENT_ID',
  ]) {
    assert.match(
      build,
      new RegExp(`${supportVar}: \\$\\{\\{ vars\\.${supportVar} \\}\\}`),
      `${supportVar} must be injected into the release build`,
    );
  }
  assert.match(build, /SENTRY_DISABLE_AUTO_UPLOAD: ["']true["']/);
  assert.match(build, /apksigner.*verify --verbose --print-certs/);
  assert.match(apkVerification, /certificate SHA-256 digest/);
  assert.match(apkVerification, /tr -d '\[:space:\]:'/);
  assert.match(apkVerification, /Actual: \$actual_cert/);
  assert.match(build, /ANDROID_CERT_SHA256/);
  assert.match(build, /windnote\.apk\.sha256/);
  assert.match(
    build,
    /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7\.0\.1/,
  );
  assert.match(upload, /retention-days: 30/);
});

test('Android release workflow publishes the verified APK and reports observable results', () => {
  const workflow = read('.github/workflows/android-release.yml');
  const preflight = workflowJob(workflow, 'preflight');
  const build = workflowJob(workflow, 'build');
  const publish = workflowJob(workflow, 'publish');
  const notify = workflowJob(workflow, 'notify');
  const publisher = workflowStep(publish, 'Publish public GitHub release');
  const notification = workflowStep(notify, 'Notify Discord');

  assert.match(publish, /needs: \[preflight, build\]/);
  // #84：文档承诺的 default-disabled 门禁现在由 workflow 强制执行 —— 只有仓库
  // 变量显式为 'true' 时 publish 才跑，v* tag 默认止步于私有 artifact。
  assert.match(
    publish,
    /if: \$\{\{ vars\.ANDROID_PUBLIC_RELEASE_ENABLED == 'true' \}\}/,
  );
  // review 修复：公开发布前强制分发证据门禁 —— 单个 ENABLED 变量误设不再
  // 足以在无证据校验下发出公网 APK。round 2：三个变量都必须显式映射进
  // 门禁步骤的 env（vars 上下文不自动注入 runner 环境）。
  const gateStep = workflowStep(publish, 'Enforce distribution evidence gate');
  assert.match(
    gateStep,
    /ANDROID_PUBLIC_RELEASE_ENABLED: \$\{\{ vars\.ANDROID_PUBLIC_RELEASE_ENABLED \}\}/,
  );
  assert.match(
    gateStep,
    /ANDROID_DISTRIBUTION_APPROVED: \$\{\{ vars\.ANDROID_DISTRIBUTION_APPROVED \}\}/,
  );
  assert.match(
    gateStep,
    /ANDROID_DISTRIBUTION_EVIDENCE_URL: \$\{\{ vars\.ANDROID_DISTRIBUTION_EVIDENCE_URL \}\}/,
  );
  // Free plan 没有 protected environment，环境保护缺位记录在
  // docs/android-release.md「Workflow enforcement status」。
  assert.doesNotMatch(publish, /environment:/);
  assert.match(publish, /ref: \$\{\{ needs\.preflight\.outputs\.commit_sha \}\}/);
  assert.match(publish, /persist-credentials: false/);
  assert.match(
    publish,
    /actions\/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8\.0\.1/,
  );
  assert.match(publish, /sha256sum -c/);
  assert.match(publish, /validate-android-release\.js distribution/);
  // 门禁必须先于发布脚本执行
  assert.ok(
    publish.indexOf('validate-android-release.js distribution') <
      publish.indexOf('publish-android-release.js'),
    'distribution gate must run before the publisher script',
  );
  assert.match(
    publish,
    /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7\.0\.0/,
  );
  const publishNodeIndex = publish.indexOf('- name: Setup Node');
  assert.ok(
    publish.indexOf('- name: Checkout validated commit') < publishNodeIndex &&
      publishNodeIndex < publish.indexOf('publish-android-release.js'),
    'publish Node setup must precede the publisher script',
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
  assert.match(notification, /continue-on-error: true/);
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

test('Android releases publish versioned and latest APKs to Cloudflare R2', () => {
  const workflow = read('.github/workflows/android-release.yml');
  const publish = workflowJob(workflow, 'publish');
  const versionedUpload = workflowStep(
    publish,
    'Upload versioned APK to Cloudflare R2',
  );
  const latestUpload = workflowStep(
    publish,
    'Promote APK to Cloudflare R2 latest',
  );
  const githubRelease = workflowStep(
    publish,
    'Publish public GitHub release',
  );

  for (const step of [versionedUpload, latestUpload]) {
    assert.match(step, /AWS_ACCESS_KEY_ID: \$\{\{ secrets\.R2_ACCESS_KEY_ID \}\}/);
    assert.match(step, /AWS_SECRET_ACCESS_KEY: \$\{\{ secrets\.R2_SECRET_ACCESS_KEY \}\}/);
    assert.match(step, /R2_ACCOUNT_ID: \$\{\{ vars\.R2_ACCOUNT_ID \}\}/);
    assert.match(step, /R2_BUCKET: windnote-apk-releases/);
  }

  assert.match(
    versionedUpload,
    /android\/releases\/\$\{RELEASE_TAG\}\/windnote\.apk/,
  );
  assert.match(versionedUpload, /application\/vnd\.android\.package-archive/);
  assert.match(versionedUpload, /sha256=/);
  assert.match(latestUpload, /android\/latest\/windnote\.apk/);
  assert.match(latestUpload, /head-object/);
  assert.match(latestUpload, /R2_PUBLIC_APK_URL/);
  assert.match(latestUpload, /curl --fail.*--head/);
  assert.match(githubRelease, /id: publish_release/);
  assert.match(
    latestUpload,
    /if: \$\{\{ steps\.publish_release\.outputs\.promote_latest == 'true' \}\}/,
  );

  const versionedIndex = publish.indexOf(
    '- name: Upload versioned APK to Cloudflare R2',
  );
  const githubIndex = publish.indexOf('- name: Publish public GitHub release');
  const latestIndex = publish.indexOf(
    '- name: Promote APK to Cloudflare R2 latest',
  );
  assert.ok(
    githubIndex < versionedIndex && versionedIndex < latestIndex,
    'R2 objects must change only after the GitHub release accepts the exact APK',
  );
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
    EXPO_PUBLIC_MEMBERSHIP_SUPPORT_USER_ID: 'official-support',
    EXPO_PUBLIC_SUPPORT_ACCOUNT_ID: 'cs-support',
  };
  const app = { version: '1.0.0', android: { versionCode: 1_000_000 } };

  assert.deepEqual(validateReleaseMetadata({ env, app }), []);

  for (const name of [
    'EXPO_PUBLIC_API_URL',
    'EXPO_PUBLIC_MEMBERSHIP_SUPPORT_USER_ID',
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
    EXPO_PUBLIC_MEMBERSHIP_SUPPORT_USER_ID: 'official-support',
    EXPO_PUBLIC_SUPPORT_ACCOUNT_ID: 'cs-support',
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
  const {
    publishRelease,
    shouldPromoteLatest,
  } = require('../.github/scripts/publish-android-release');
  const apkPath = path.join(process.cwd(), 'test', 'fixture-windnote.apk');
  const apkContents = Buffer.from('signed apk fixture');
  const digest = `sha256:${crypto.createHash('sha256').update(apkContents).digest('hex')}`;
  fs.writeFileSync(apkPath, apkContents);

  try {
    const createCalls = [];
    const createResult = publishRelease({
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
    assert.deepEqual(createResult, { promoteLatest: true });

    const rerunCalls = [];
    const rerunResult = publishRelease({
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
    assert.deepEqual(rerunResult, { promoteLatest: false });

    assert.equal(shouldPromoteLatest('v2.0.0', ''), true);
    assert.equal(shouldPromoteLatest('v2.0.0', 'v2.0.0'), true);
    assert.equal(shouldPromoteLatest('v2.0.1', 'v2.0.0'), true);
    assert.equal(shouldPromoteLatest('v1.9.9', 'v2.0.0'), false);

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

test('release helper writes the latest-promotion decision to GitHub Actions output', () => {
  const { writePromoteLatestOutput } = require('../.github/scripts/publish-android-release');
  const outputPath = path.join(process.cwd(), 'test', 'fixture-github-output.txt');

  try {
    writePromoteLatestOutput(true, outputPath);
    writePromoteLatestOutput(false, outputPath);
    assert.equal(
      fs.readFileSync(outputPath, 'utf8'),
      'promote_latest=true\npromote_latest=false\n',
    );
  } finally {
    fs.rmSync(outputPath, { force: true });
  }
});

test('release preflight fails closed when support routing would fall back to imAdmin', () => {
  const {
    validateSupportAccounts,
  } = require('../.github/scripts/validate-android-release');

  // 全空:通用与四类专属都没配 → 充值 / 纠纷 / 账号客服会静默落到系统账号 imAdmin,必须报错。
  const blank = [];
  validateSupportAccounts(blank, {});
  assert.equal(blank.length, 1);
  assert.match(blank[0], /imAdmin/);

  // 只配通用客服账号 EXPO_PUBLIC_SUPPORT_ACCOUNT_ID → 通过(有可信兜底)。
  const generic = [];
  validateSupportAccounts(generic, {
    EXPO_PUBLIC_SUPPORT_ACCOUNT_ID: 'cs-generic',
  });
  assert.deepEqual(generic, []);

  // 通用为空但四类专属全配齐 → 通过。
  const perCategory = [];
  validateSupportAccounts(perCategory, {
    EXPO_PUBLIC_SUPPORT_RECHARGE_ID: 'cs-r',
    EXPO_PUBLIC_SUPPORT_ISSUE_ID: 'cs-i',
    EXPO_PUBLIC_SUPPORT_DISPUTE_ID: 'cs-d',
    EXPO_PUBLIC_SUPPORT_ACCOUNT_AGENT_ID: 'cs-a',
  });
  assert.deepEqual(perCategory, []);

  // 专属只配了一部分、通用又为空 → 仍报错,并点名缺失的那一类。
  const partial = [];
  validateSupportAccounts(partial, {
    EXPO_PUBLIC_SUPPORT_RECHARGE_ID: 'cs-r',
  });
  assert.equal(partial.length, 1);
  assert.match(partial[0], /EXPO_PUBLIC_SUPPORT_ISSUE_ID/);

  // 空白字符不算已配(trim 后为空) → 报错。
  const whitespace = [];
  validateSupportAccounts(whitespace, { EXPO_PUBLIC_SUPPORT_ACCOUNT_ID: '   ' });
  assert.equal(whitespace.length, 1);
});

test('release preflight forwards support-account variables so the validator can see them', () => {
  const workflow = read('.github/workflows/android-release.yml');

  // GitHub repository variables 不会自动进 process.env。preflight 步若不显式转发这些客服
  // 变量,validateSupportAccounts 每次都看到全空、打 tag 就在测试/构建之前 fail——即便仓库
  // 其实配好了(#131 P1)。这些必须和 build 步一致地转发。
  const preflight = workflow.slice(
    workflow.indexOf('Validate release metadata and ancestry'),
    workflow.indexOf('Install dependencies'),
  );
  assert.ok(preflight.length > 0, 'preflight step block located');
  for (const name of [
    'EXPO_PUBLIC_SUPPORT_ACCOUNT_ID',
    'EXPO_PUBLIC_SUPPORT_RECHARGE_ID',
    'EXPO_PUBLIC_SUPPORT_ISSUE_ID',
    'EXPO_PUBLIC_SUPPORT_DISPUTE_ID',
    'EXPO_PUBLIC_SUPPORT_ACCOUNT_AGENT_ID',
  ]) {
    assert.match(
      preflight,
      new RegExp(`${name}: \\$\\{\\{ vars\\.${name} \\}\\}`),
      `preflight forwards ${name}`,
    );
  }
});
