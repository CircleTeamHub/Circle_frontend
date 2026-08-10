const test = require('node:test');
const assert = require('node:assert/strict');

test('local Sentry upload config disables Xcode auto upload whenever credentials are incomplete', () => {
  const {
    appendSentryDisableAutoUpload,
  } = require('../plugins/with-local-sentry-auto-upload-disabled');

  const input = 'export NODE_BINARY=/usr/local/bin/node\n';
  const output = appendSentryDisableAutoUpload(input);

  assert.match(output, /export NODE_BINARY=\/usr\/local\/bin\/node/);
  assert.doesNotMatch(output, /\$CONFIGURATION|Debug/);
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

test('local Sentry upload config adds an Android upload guard once', () => {
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
  assert.doesNotMatch(output, /isCiBuild|EAS_BUILD/);
  assert.equal(
    appendAndroidSentryUploadGuard(output),
    output,
    'applying the plugin repeatedly should not duplicate the Gradle guard',
  );
});
