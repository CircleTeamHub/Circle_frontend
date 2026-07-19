const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// src/im/client.ts is a ~1300-line layer coupled to the native OpenIM SDK and
// several stores, so it is not practically loadable in a vm. These source-level
// assertions guard that the error reporting stays wired into the critical IM
// operations (init / login / logout / send).
const src = fs.readFileSync(
  path.join(process.cwd(), 'src/im/client.ts'),
  'utf8',
);

test('im client imports reportError', () => {
  assert.match(
    src,
    /import \{ reportError \} from ['"]@\/observability\/sentry['"]/,
  );
});

test('all message sends funnel through a reporting wrapper', () => {
  // The wrapper exists and reports with kind 'sendMessage'.
  assert.match(src, /function reportSend\(/);
  assert.match(src, /reportError\(\s*error,\s*\{\s*operation: 'openim',\s*kind: 'sendMessage'/);
  // No raw OpenIMSDK.sendMessage( call sites remain (all go through reportSend).
  assert.doesNotMatch(src, /OpenIMSDK\.sendMessage\(/);
});

test('init / login / logout failures are reported', () => {
  assert.match(src, /reportError\([^;]*kind: 'init'/);
  assert.match(src, /reportError\([^;]*kind: 'login'/);
  assert.match(src, /reportError\([^;]*kind: 'logout'/);
});
