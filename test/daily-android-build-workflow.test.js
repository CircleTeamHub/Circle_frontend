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
  assert.doesNotMatch(workflow, /base64 --decode|base64 -d/);

  const keyStep = workflowStep(build, 'Create throwaway signing key');
  assert.match(keyStep, /keytool -genkeypair/);
  assert.match(keyStep, /openssl rand -hex 32/);
  assert.match(keyStep, /::add-mask::/);
  assert.match(keyStep, /ANDROID_KEYSTORE_PATH=\$keystore_path/);
  assert.match(keyStep, /ANDROID_KEY_ALIAS=daily-validation/);

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
  assert.match(verify, /app-release\.apk/);
  assert.match(verify, /mapping\/release\/mapping\.txt/);
  assert.match(verify, /enableMinifyInReleaseBuilds/);
  assert.equal((verify.match(/exit 1/g) || []).length, 2);
  assert.match(verify, /GITHUB_STEP_SUMMARY/);
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
