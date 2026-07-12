const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// src/im/client.ts is coupled to the native OpenIM SDK and cannot load in a vm,
// so — like im-error-reporting.test.js — these are source-level guards. They lock
// in the "zombie login" self-heal: after a hot-reload / reinstall the native SDK
// can report Logged while its resources are unloaded (every call throws 10004 and
// the conversation list comes back empty). loginToOpenIM must probe and rebuild
// instead of blindly trusting getLoginStatus().
const src = fs.readFileSync(
  path.join(process.cwd(), 'src/im/client.ts'),
  'utf8',
);

test('a read-only probe verifies resources are actually loaded (not just Logged)', () => {
  assert.match(src, /async function isOpenIMSessionResourceLoaded\(/);
  // The probe is a cheap resource-bound read.
  assert.match(src, /isOpenIMSessionResourceLoaded[\s\S]*OpenIMSDK\.getSelfUserInfo\(/);
  // The Logged branch consults the probe before reporting connected.
  assert.match(
    src,
    /LoginStatus\.Logged[\s\S]*if \(await isOpenIMSessionResourceLoaded\(\)\)/,
  );
});

test('the 10004 "resource not loaded" signal is recognised', () => {
  assert.match(src, /function isOpenIMResourceNotLoadedError\(/);
  assert.match(src, /code === 10004/);
  assert.match(src, /not load resource|Resource initialization incomplete/);
});

test('self-heal rebuilds via unInitSDK (login/logout alone cannot recover)', () => {
  // A stale "Logged but unloaded" state deadlocks login (10102) / logout (10004);
  // the only recovery is a full unInitSDK -> initSDK -> login.
  assert.match(src, /OpenIMSDK\.unInitSDK\(/);
  assert.match(src, /reportError\([^;]*op: 'unInit'/);
  // After tearing down it forces a fresh init before the clean login.
  assert.match(
    src,
    /unInitSDK\([\s\S]*initPromise = null[\s\S]*ensureOpenIMInitialized\(\)/,
  );
});

test('a once-per-lifetime guard prevents a login loop', () => {
  assert.match(src, /let staleLoginSelfHealAttempted = false/);
  // Set before healing, cleared only after a clean login succeeds.
  assert.match(src, /staleLoginSelfHealAttempted = true/);
  assert.match(
    src,
    /await OpenIMSDK\.login\([\s\S]*staleLoginSelfHealAttempted = false/,
  );
});
