const test = require('node:test');
const assert = require('node:assert/strict');

test('local Sentry upload config fails CI/EAS Release archives when credentials are incomplete', () => {
  const {
    appendSentryDisableAutoUpload,
  } = require('../plugins/with-local-sentry-auto-upload-disabled');

  const input = 'export NODE_BINARY=/usr/local/bin/node\n';
  const output = appendSentryDisableAutoUpload(input);

  assert.match(output, /export NODE_BINARY=\/usr\/local\/bin\/node/);
  assert.match(output, /\$CONFIGURATION/);
  assert.match(output, /CI:-/);
  assert.match(output, /EAS_BUILD:-/);
  assert.match(output, /exit 1/);
  assert.match(output, /-z "\$SENTRY_AUTH_TOKEN"/);
  assert.match(output, /-z "\$SENTRY_ORG"/);
  assert.match(output, /-z "\$SENTRY_PROJECT"/);
  assert.match(output, /export SENTRY_DISABLE_AUTO_UPLOAD=true/);
  assert.equal(
    appendSentryDisableAutoUpload(output),
    output,
    'applying the plugin repeatedly should not duplicate the flag',
  );
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
