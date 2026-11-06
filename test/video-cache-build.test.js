const test = require('node:test');
const assert = require('node:assert/strict');
const packageJson = require('../package.json');
const eas = require('../eas.json');

test('Android builds the patched video module from source instead of using an unpatched precompiled artifact', () => {
  assert.ok(packageJson.expo?.autolinking?.android?.buildFromSource?.includes('expo-video'));
});

test('production iOS builds do not bypass the native patch with precompiled Expo modules', () => {
  assert.equal(eas.build.production.env?.EXPO_USE_PRECOMPILED_MODULES, '0');
});
