const test = require('node:test');
const assert = require('node:assert/strict');

const { spawnSync } = require('node:child_process');

// 把插件写进 ios/.xcode.env 的那段 shell 真正跑一遍：Xcode 的每个构建脚本都会
// source 它，exit 1 就是这次构建失败。只比对字符串的话，条件写反了也照样全绿。
function runXcodeEnvGuard(env) {
  const {
    appendSentryDisableAutoUpload,
  } = require('../plugins/with-local-sentry-auto-upload-disabled');
  const block = appendSentryDisableAutoUpload('');
  const result = spawnSync(
    'bash',
    ['-c', `${block}\necho "FLAG=\${SENTRY_DISABLE_AUTO_UPLOAD:-unset}"`],
    { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' },
  );
  return { status: result.status, flag: /FLAG=(\S+)/.exec(result.stdout)?.[1], stderr: result.stderr };
}

const IOS_CREDENTIALS = { SENTRY_AUTH_TOKEN: 'token', SENTRY_ORG: 'windnote', SENTRY_PROJECT: 'react-native' };

test('an iOS Release build without Sentry credentials fails, local or CI', () => {
  // 之前只在 CI/EAS 上失败；本地打的 Release 包（同样会被分发）静默跳过上传，
  // 于是那个版本的崩溃栈在 Sentry 里永远是符号化不了的地址。
  for (const env of [{ CONFIGURATION: 'Release' }, { CONFIGURATION: 'Release', CI: 'true' }]) {
    const result = runXcodeEnvGuard(env);
    assert.equal(result.status, 1, JSON.stringify(env));
    assert.match(result.stderr, /SENTRY_DISABLE_AUTO_UPLOAD=true/, 'the error names the escape hatch');
  }
  const partial = runXcodeEnvGuard({ CONFIGURATION: 'Release', SENTRY_AUTH_TOKEN: 'token' });
  assert.equal(partial.status, 1);
});

test('an explicit SENTRY_DISABLE_AUTO_UPLOAD=true opts a never-distributed Release build out', () => {
  const result = runXcodeEnvGuard({ CONFIGURATION: 'Release', SENTRY_DISABLE_AUTO_UPLOAD: 'true' });
  assert.equal(result.status, 0);
  assert.equal(result.flag, 'true');
});

test('Debug builds without credentials skip the upload quietly; configured builds upload', () => {
  const debug = runXcodeEnvGuard({ CONFIGURATION: 'Debug' });
  assert.equal(debug.status, 0);
  assert.equal(debug.flag, 'true');

  const configured = runXcodeEnvGuard({ CONFIGURATION: 'Release', ...IOS_CREDENTIALS });
  assert.equal(configured.status, 0);
  assert.equal(configured.flag, 'unset');
});

test('the iOS guard block is idempotent and replaces older variants', () => {
  const {
    appendSentryDisableAutoUpload,
  } = require('../plugins/with-local-sentry-auto-upload-disabled');
  const input = 'export NODE_BINARY=/usr/local/bin/node\n';
  const output = appendSentryDisableAutoUpload(input);
  assert.match(output, /export NODE_BINARY=\/usr\/local\/bin\/node/);
  assert.equal(appendSentryDisableAutoUpload(output), output);
  const legacy = `${input}export SENTRY_DISABLE_AUTO_UPLOAD=true\n`;
  assert.equal(appendSentryDisableAutoUpload(legacy), output);
});

test('local Sentry upload config fails Android CI/EAS Release uploads when credentials are incomplete', () => {
  const {
    appendAndroidSentryUploadGuard,
  } = require('../plugins/with-local-sentry-auto-upload-disabled');

  const input = 'android {\\n}\\n';
  const output = appendAndroidSentryUploadGuard(input);

  assert.match(output, /tasks\.configureEach/);
  assert.match(output, /SentryUpload/);
  assert.match(output, /System\.getenv\("SENTRY_AUTH_TOKEN"\)/);
  assert.match(output, /System\.getenv\("SENTRY_ORG"\)/);
  assert.match(output, /System\.getenv\("SENTRY_PROJECT"\)/);
  assert.match(output, /isCiOrEasBuild/);
  assert.match(output, /EAS_BUILD/);
  assert.match(output, /GradleException/);
  assert.equal(
    appendAndroidSentryUploadGuard(output),
    output,
    'applying the plugin repeatedly should not duplicate the Gradle guard',
  );
});

// 这道守卫要抓的是「忘了配」。而每日构建是显式声明「本次不上传」——它签一次性密钥、
// 产物永不分发，把它的 debug 文件传上 Sentry 反而会污染项目（一个并不存在的 release）。
// daily-android-build.yml 早就设了 SENTRY_DISABLE_AUTO_UPLOAD=true，但这段 Groovy
// 从不读它，于是 onlyIf 直接抛异常 —— 两处自家配置互相矛盾，assembleRelease 必然失败。
// SENTRY_DISABLE_AUTO_UPLOAD 也正是 sentry.gradle 自己的 shouldSentryAutoUploadGeneral()
// 判断的那个变量，尊重它同时也是与上游语义对齐。
test('Android Sentry guard honours an explicit SENTRY_DISABLE_AUTO_UPLOAD opt-out', () => {
  const {
    appendAndroidSentryUploadGuard,
  } = require('../plugins/with-local-sentry-auto-upload-disabled');

  const output = appendAndroidSentryUploadGuard('android {\\n}\\n');

  assert.match(output, /System\.getenv\("SENTRY_DISABLE_AUTO_UPLOAD"\)/);

  // 顺序即语义：显式关闭必须在抛异常之前短路，否则读了也没用。
  assert.ok(
    output.indexOf('SENTRY_DISABLE_AUTO_UPLOAD') < output.indexOf('GradleException'),
    'the explicit opt-out must short-circuit before the guard throws',
  );

  // 报错信息要写明逃生口，否则下一个撞上的人只能去读 Groovy。
  assert.match(output, /SENTRY_DISABLE_AUTO_UPLOAD/);
});

test('a CI workflow re-checks the iOS Sentry wiring whenever Expo config or plugins change', () => {
  // 没有 iOS 发版 CI：至少在 Linux 上 prebuild 一次，确认守卫和符号上传阶段还在。
  const fs = require('node:fs');
  const path = require('node:path');
  const workflow = fs.readFileSync(
    path.join(process.cwd(), '.github/workflows/ios-sentry-config.yml'),
    'utf8',
  );
  for (const trigger of ["'app.json'", "'app.config.js'", "'plugins/**'", "'package.json'"]) {
    assert.ok(workflow.includes(trigger), `workflow should trigger on ${trigger}`);
  }
  assert.match(workflow, /npx expo prebuild --platform ios --no-install --clean/);
  assert.match(workflow, /node \.github\/scripts\/verify-ios-sentry-config\.js/);
});

test('the iOS guard never expands the auth token into an xtrace build log', () => {
  // sentry-xcode-debug-files.sh 先 set -x 再 source .xcode.env：`-z "$SENTRY_AUTH_TOKEN"`
  // 在 xtrace 下会把令牌原文打进 Xcode / EAS 构建日志。
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const {
    appendSentryDisableAutoUpload,
  } = require('../plugins/with-local-sentry-auto-upload-disabled');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xcode-env-'));
  fs.writeFileSync(path.join(dir, '.xcode.env'), appendSentryDisableAutoUpload(''));
  const result = spawnSync('bash', ['-xc', `source "${dir}/.xcode.env"`], {
    env: {
      PATH: process.env.PATH,
      CONFIGURATION: 'Release',
      SENTRY_AUTH_TOKEN: 'sntrys_SECRET_TOKEN',
      SENTRY_ORG: 'windnote',
      SENTRY_PROJECT: 'react-native',
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  assert.doesNotMatch(result.stderr, /sntrys_SECRET_TOKEN/);
});

test('a local opt-out in ios/.xcode.env.local covers Xcode GUI Release builds', () => {
  // Product > Profile / Archive 从 Xcode 界面启动，带不进环境变量；而 .xcode.env.local
  // 要到守卫之后才被 source。守卫自己读一下同目录 .xcode.env.local 里的显式声明。
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const {
    appendSentryDisableAutoUpload,
  } = require('../plugins/with-local-sentry-auto-upload-disabled');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xcode-env-'));
  fs.writeFileSync(path.join(dir, '.xcode.env'), appendSentryDisableAutoUpload(''));
  const sourceIt = () =>
    spawnSync('bash', ['-c', `source "${dir}/.xcode.env"; echo "FLAG=\${SENTRY_DISABLE_AUTO_UPLOAD:-unset}"`], {
      env: { PATH: process.env.PATH, CONFIGURATION: 'Release' },
      encoding: 'utf8',
    });

  assert.equal(sourceIt().status, 1, 'no opt-out: still fails');

  fs.writeFileSync(path.join(dir, '.xcode.env.local'), 'export NODE_BINARY=/opt/node\nexport SENTRY_DISABLE_AUTO_UPLOAD=true\n');
  const optedOut = sourceIt();
  assert.equal(optedOut.status, 0);
  assert.match(optedOut.stdout, /FLAG=true/);
  assert.match(optedOut.stdout + optedOut.stderr, /warning: .*Sentry/);
});
