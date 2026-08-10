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
