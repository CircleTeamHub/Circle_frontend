const test = require('node:test');
const assert = require('node:assert/strict');

test('local Sentry upload config disables Xcode auto upload only without an auth token', () => {
  const {
    appendSentryDisableAutoUpload,
  } = require('../plugins/with-local-sentry-auto-upload-disabled');

  const input = 'export NODE_BINARY=/usr/local/bin/node\n';
  const output = appendSentryDisableAutoUpload(input);

  assert.match(output, /export NODE_BINARY=\/usr\/local\/bin\/node/);
  assert.match(output, /if \[ -z "\$SENTRY_AUTH_TOKEN" \]; then/);
  assert.match(output, /export SENTRY_DISABLE_AUTO_UPLOAD=true/);
  assert.equal(
    appendSentryDisableAutoUpload(output),
    output,
    'applying the plugin repeatedly should not duplicate the flag',
  );
});
