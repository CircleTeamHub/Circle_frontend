const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WORKFLOW_PATH = '.github/workflows/daily-android-build.yml';

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

test('daily Android build runs on a schedule and is never a release entry point', () => {
  const workflow = read(WORKFLOW_PATH);

  assert.match(workflow, /schedule:\s*\n\s+# 02:00 Asia\/Shanghai\.\s*\n\s+- cron: "0 18 \* \* \*"/);
  assert.match(workflow, /workflow_dispatch:/);

  // 一旦这个 workflow 能被 push / tag 触发，它就从「验证」变成了第二条发布入口，
  // 而它签名用的是一次性密钥——产出的包永远不该有机会流向任何分发渠道。
  assert.doesNotMatch(workflow, /\n\s+push:/);
  assert.doesNotMatch(workflow, /\n\s+tags:/);
  assert.doesNotMatch(workflow, /\n\s+pull_request:/);

  assert.match(workflow, /permissions:\s*\n\s+contents: read/);
  assert.doesNotMatch(workflow, /contents: write/);
  assert.match(workflow, /group: daily-android-build/);
  assert.match(workflow, /cancel-in-progress: false/);
});

test('daily Android build publishes nothing', () => {
  const workflow = read(WORKFLOW_PATH);

  for (const forbidden of [
    'upload-artifact',
    'download-artifact',
    'publish-android-release.js',
    'RELEASES_TOKEN',
    'R2_ACCESS_KEY_ID',
    'r2.cloudflarestorage.com',
    'windnote-releases',
    'gh release',
  ]) {
    assert.doesNotMatch(
      workflow,
      new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `daily build must not reference ${forbidden}`,
    );
  }
});

test('daily Android build never decodes production signing material', () => {
  const workflow = read(WORKFLOW_PATH);
  const build = workflowJob(workflow, 'native_build');

  // 构建 job 完全不碰生产签名 secret：一次性密钥就地生成，生产 keystore 不落盘。
  assert.doesNotMatch(build, /secrets\./);
  assert.doesNotMatch(build, /base64 --decode|base64 -d/);

  const keyStep = workflowStep(build, 'Create throwaway signing key');
  assert.match(keyStep, /keytool -genkeypair/);
  assert.match(keyStep, /openssl rand -hex 32/);
  assert.match(keyStep, /::add-mask::/);
  assert.match(keyStep, /ANDROID_KEYSTORE_PATH=\$keystore_path/);

  // 口令只走 step output、只注入构建那一步（和 android-release.yml 的作用域一致）。
  // 写进 $GITHUB_ENV 会让它出现在后续每一步的环境里，没有任何必要。
  assert.match(keyStep, /keystore_password=\$keystore_password" >> "\$GITHUB_OUTPUT/);
  assert.doesNotMatch(keyStep, /ANDROID_KEYSTORE_PASSWORD=.*GITHUB_ENV/);
  assert.doesNotMatch(keyStep, /ANDROID_KEY_PASSWORD/);

  const buildStep = workflowStep(build, 'Build release-like APK');
  for (const name of ['ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_PASSWORD']) {
    assert.match(
      buildStep,
      new RegExp(
        `${name}: \\$\\{\\{ steps\\.signing\\.outputs\\.keystore_password \\}\\}`,
      ),
      `${name} must be scoped to the build step`,
    );
  }
  assert.match(buildStep, /ANDROID_KEY_ALIAS: daily-validation/);

  const cleanup = workflowStep(build, 'Discard throwaway signing key');
  assert.match(cleanup, /if: \$\{\{ always\(\) \}\}/);
  assert.match(cleanup, /rm -rf "\$RUNNER_TEMP\/daily-signing"/);
});

test('daily Android build exercises the tag-time native release path', () => {
  const workflow = read(WORKFLOW_PATH);
  const build = workflowJob(workflow, 'native_build');
  const release = read('.github/workflows/android-release.yml');

  assert.match(build, /npm ci/);
  assert.match(build, /npx expo prebuild --platform android --clean --no-install/);

  // 每日构建和 tag 构建必须是同一条 Gradle 命令：一旦发布那边改了参数（架构、
  // 任务名）而这边没跟上，这个 workflow 就只是在验证一条没人会发布的路径。
  const gradleCommand =
    /\.\/gradlew assembleRelease --no-daemon -PreactNativeArchitectures=arm64-v8a/;
  assert.match(build, gradleCommand);
  assert.match(release, gradleCommand);
  assert.match(build, /working-directory: android/);

  // 客服账号变量必须和 android-release.yml 的构建步一致地转发进来，否则每日构建
  // 编译的是 imAdmin 回落分支，而不是生产真正会走的分支。
  for (const name of [
    'EXPO_PUBLIC_API_URL',
    'EXPO_PUBLIC_OPENIM_API_URL',
    'EXPO_PUBLIC_OPENIM_WS_URL',
    'EXPO_PUBLIC_MEDIA_ORIGINS',
    'EXPO_PUBLIC_MEMBERSHIP_SUPPORT_USER_ID',
    'EXPO_PUBLIC_SUPPORT_ACCOUNT_ID',
    'EXPO_PUBLIC_SUPPORT_RECHARGE_ID',
    'EXPO_PUBLIC_SUPPORT_ISSUE_ID',
    'EXPO_PUBLIC_SUPPORT_DISPUTE_ID',
    'EXPO_PUBLIC_SUPPORT_ACCOUNT_AGENT_ID',
  ]) {
    assert.match(
      build,
      new RegExp(`${name}: \\$\\{\\{ vars\\.${name} \\}\\}`),
      `${name} must be forwarded to the daily Gradle build`,
    );
  }
});

test('daily Android build fails loudly instead of silently passing', () => {
  const workflow = read(WORKFLOW_PATH);
  const verify = workflowStep(
    workflowJob(workflow, 'native_build'),
    'Verify release-like output',
  );

  // 缺 APK 或缺 R8 mapping 都必须 exit 1。app.json 开着 minify/shrinkResources，
  // 没有 mapping 就意味着 minify 静默没跑——只看 gradle 退出码是发现不了的。
  //
  // 断言的是「这两个守卫各自 fail-closed」，不是 exit 1 的条数：后者会让新增第三个
  // 守卫（明明是加强）把测试打红，测的是实现而不是契约。
  for (const [what, guard] of [
    ['missing APK', /if \[ ! -f "\$apk_path" \][\s\S]{0,200}?exit 1/],
    ['missing R8 mapping', /if \[ ! -s "\$mapping_path" \][\s\S]{0,200}?exit 1/],
  ]) {
    assert.match(verify, guard, `${what} must fail the job`);
  }
  assert.match(verify, /app-release\.apk/);
  assert.match(verify, /mapping\/release\/mapping\.txt/);
  assert.match(verify, /enableMinifyInReleaseBuilds/);
  assert.match(verify, /GITHUB_STEP_SUMMARY/);
});

test('daily Android build refuses to compile the support fallback branch', () => {
  const workflow = read(WORKFLOW_PATH);
  const build = workflowJob(workflow, 'native_build');
  const validate = workflowStep(build, 'Validate build environment');

  // 只转发变量而不校验，等于允许「变量被删/写错 → 编译 imAdmin 回落分支 → 构建全绿」。
  // 这跟缺 R8 mapping 是同一类静默失效，只是更容易发生。
  assert.match(validate, /validate-android-release\.js build-env/);
  for (const name of [
    'EXPO_PUBLIC_API_URL',
    'EXPO_PUBLIC_OPENIM_API_URL',
    'EXPO_PUBLIC_OPENIM_WS_URL',
    'EXPO_PUBLIC_MEDIA_ORIGINS',
    'EXPO_PUBLIC_MEMBERSHIP_SUPPORT_USER_ID',
    'EXPO_PUBLIC_SUPPORT_ACCOUNT_ID',
    'EXPO_PUBLIC_SUPPORT_RECHARGE_ID',
    'EXPO_PUBLIC_SUPPORT_ISSUE_ID',
    'EXPO_PUBLIC_SUPPORT_DISPUTE_ID',
    'EXPO_PUBLIC_SUPPORT_ACCOUNT_AGENT_ID',
  ]) {
    assert.match(
      validate,
      new RegExp(`${name}: \\$\\{\\{ vars\\.${name} \\}\\}`),
      `${name} must reach the validator, not just Gradle`,
    );
  }

  // 必须先于昂贵步骤：变量缺失应该 30 秒暴露，而不是 40 分钟后。
  assert.ok(
    build.indexOf('- name: Validate build environment') <
      build.indexOf('- name: Build release-like APK'),
    'env validation must run before the Gradle build',
  );
});

test('build-env validation shares the tag-time env contract', () => {
  const {
    validateBuildEnv,
    validateReleaseMetadata,
  } = require('../.github/scripts/validate-android-release');
  const env = {
    EXPO_PUBLIC_API_URL: 'https://api.windnote.test',
    EXPO_PUBLIC_OPENIM_API_URL: 'https://im.windnote.test',
    EXPO_PUBLIC_OPENIM_WS_URL: 'wss://im.windnote.test/ws',
    EXPO_PUBLIC_MEMBERSHIP_SUPPORT_USER_ID: 'official-support',
    EXPO_PUBLIC_SUPPORT_ACCOUNT_ID: 'cs-support',
  };

  // 没有 RELEASE_TAG 也能通过 —— 每日构建本来就没有 tag。
  assert.deepEqual(validateBuildEnv({ env }), []);

  // 但发布路径的 tag 校验一条不少：build-env 是子集，不是替代品。
  assert.match(
    validateReleaseMetadata({ env, app: { version: '1.0.0' } }).join('\n'),
    /RELEASE_TAG/,
  );

  // 每一项 env 失效都必须被 build-env 抓到，否则等于没校验。
  for (const name of Object.keys(env)) {
    const broken = { ...env, [name]: '' };
    assert.ok(
      validateBuildEnv({ env: broken }).length > 0,
      `build-env must reject a blank ${name}`,
    );
  }
  assert.match(
    validateBuildEnv({ env: { ...env, EXPO_PUBLIC_API_URL: 'http://a.test' } }).join(
      '\n',
    ),
    /EXPO_PUBLIC_API_URL.*https/,
  );
});

test('Sentry DSN reaches both the validator and the compiled package', () => {
  const workflow = read(WORKFLOW_PATH);
  const build = workflowJob(workflow, 'native_build');
  const release = read('.github/workflows/android-release.yml');

  // 这条断言存在的原因：DSN 曾经完全没被转发，于是每个 release 包里的 Sentry 都是
  // 静默 no-op —— 崩溃/卡死一条都没上报，而构建全绿。变量必须同时到达
  // ①校验器（好在缺失时告警）和 ②Gradle（否则编译进包的是空 DSN）。
  const dsn = /EXPO_PUBLIC_SENTRY_DSN: \$\{\{ vars\.EXPO_PUBLIC_SENTRY_DSN \}\}/;
  assert.match(workflowStep(build, 'Validate build environment'), dsn);
  assert.match(workflowStep(build, 'Build release-like APK'), dsn);

  // tag 发布那条线同样要有，否则每日构建有上报、真正发出去的包没有。
  assert.match(release, dsn);
  assert.ok(
    release.match(new RegExp(dsn.source, 'g')).length >= 2,
    'release workflow must forward the DSN to both its validator and its build step',
  );
});

test('Sentry DSN is warned about when missing and rejected when malformed', () => {
  const {
    collectBuildEnvWarnings,
    validateBuildEnv,
  } = require('../.github/scripts/validate-android-release');
  const env = {
    EXPO_PUBLIC_API_URL: 'https://api.windnote.test',
    EXPO_PUBLIC_OPENIM_API_URL: 'https://im.windnote.test',
    EXPO_PUBLIC_OPENIM_WS_URL: 'wss://im.windnote.test/ws',
    EXPO_PUBLIC_MEMBERSHIP_SUPPORT_USER_ID: 'official-support',
    EXPO_PUBLIC_SUPPORT_ACCOUNT_ID: 'cs-support',
  };

  // 缺失 = 告警，不是错误：没有 DSN 时 app 完全正常，只是不上报。硬 fail 会把
  // 「还没接 Sentry」变成「不能发版」。
  assert.deepEqual(validateBuildEnv({ env }), []);
  assert.match(collectBuildEnvWarnings({ env }).join('\n'), /EXPO_PUBLIC_SENTRY_DSN/);

  const valid = { ...env, EXPO_PUBLIC_SENTRY_DSN: 'https://abc123@o42.ingest.sentry.io/4507' };
  assert.deepEqual(validateBuildEnv({ env: valid }), []);
  assert.deepEqual(collectBuildEnvWarnings({ env: valid }), []);

  // 配了但配错 = 错误：Sentry.init 会静默失败，看起来「已接好」实则和没配一样。
  for (const [what, dsn] of [
    ['not a URL', 'nope'],
    ['http instead of https', 'http://abc123@o42.ingest.sentry.io/4507'],
    ['missing public key', 'https://o42.ingest.sentry.io/4507'],
    ['carries a secret key', 'https://abc123:secret@o42.ingest.sentry.io/4507'],
    ['no numeric project id', 'https://abc123@o42.ingest.sentry.io/'],
  ]) {
    assert.ok(
      validateBuildEnv({ env: { ...env, EXPO_PUBLIC_SENTRY_DSN: dsn } }).length > 0,
      `build-env must reject a DSN that is ${what}`,
    );
  }
});

test('daily Android build checks production signing config in an isolated job', () => {
  const workflow = read(WORKFLOW_PATH);
  const signing = workflowJob(workflow, 'signing_config');

  assert.match(signing, /validate-android-release\.js signing/);
  assert.match(
    signing,
    /ANDROID_CERT_SHA256: \$\{\{ vars\.ANDROID_CERT_SHA256 \}\}/,
  );
  for (const name of [
    'ANDROID_KEYSTORE_BASE64',
    'ANDROID_KEYSTORE_PASSWORD',
    'ANDROID_KEY_ALIAS',
    'ANDROID_KEY_PASSWORD',
  ]) {
    assert.match(signing, new RegExp(`${name}: \\$\\{\\{ secrets\\.${name} \\}\\}`));
  }

  // 校验器只读环境变量，不需要装依赖也不需要写文件。
  assert.doesNotMatch(signing, /npm ci/);
  assert.doesNotMatch(signing, /gradlew/);
});

test('daily signing check proves the production keystore and credentials agree', () => {
  const workflow = read(WORKFLOW_PATH);
  const signing = workflowJob(workflow, 'signing_config');

  // 非空字符串和一个格式正确的指纹不能证明 keystore 可解码、口令/alias 可用，
  // 也不能证明仓库变量里的证书指纹仍对应当前密钥。每日门禁必须实际打开密钥。
  assert.match(signing, /base64 --decode/);
  assert.match(signing, /keytool -list -v/);
  assert.match(signing, /jarsigner/);
  assert.match(signing, /ANDROID_KEYSTORE_PASSWORD/);
  assert.match(signing, /ANDROID_KEY_ALIAS/);
  assert.match(signing, /ANDROID_CERT_SHA256/);
  assert.match(signing, /actual_cert/);
  assert.match(signing, /expected_cert/);
  assert.match(signing, /actual_cert.*!=.*expected_cert/);
  assert.match(signing, /if: \$\{\{ always\(\) \}\}/);
});

test('daily Android build alerts Discord when the release path breaks', () => {
  const workflow = read(WORKFLOW_PATH);
  const notify = workflowJob(workflow, 'notify');

  assert.match(notify, /needs:\s*\n\s+- native_build\s*\n\s+- signing_config/);
  assert.match(notify, /always\(\)/);
  assert.match(notify, /contains\(join\(needs\.\*\.result, ','\), 'failure'\)/);
  assert.match(notify, /contains\(join\(needs\.\*\.result, ','\), 'cancelled'\)/);
  assert.match(notify, /DISCORD_WEBHOOK_URL: \$\{\{ secrets\.DISCORD_WEBHOOK_URL \}\}/);

  // webhook 没配时静默跳过，而不是让通知 job 失败——否则每天多一条与代码无关的红叉。
  assert.match(notify, /if: \$\{\{ env\.DISCORD_WEBHOOK_URL != '' \}\}/);
  assert.match(notify, /curl --fail-with-body/);
});
