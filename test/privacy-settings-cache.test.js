const test = require('node:test');
const assert = require('node:assert/strict');
const { createPageSnapshotEnv, plain } = require('./helpers/page-snapshot-env');

const MODULE = 'src/features/profile/privacy-settings-cache.ts';
const settings = (showWechat) => ({ showWechat });

function setup() {
  const env = createPageSnapshotEnv();
  const epoch = env.signIn('user-a');
  return { env, epoch, cache: env.load(MODULE) };
}

test('nothing is cached before the first load, or while signed out', () => {
  const { epoch, cache } = setup();
  assert.equal(cache.readPrivacySettingsCache(epoch), null);
  const signedOut = createPageSnapshotEnv();
  const signedOutCache = signedOut.load(MODULE);
  signedOutCache.writePrivacySettingsCache(0, settings(true));
  assert.equal(signedOutCache.readPrivacySettingsCache(0), null);
});

test('the next visit reads back the last saved settings, also after a restart', () => {
  const { env, epoch, cache } = setup();
  cache.writePrivacySettingsCache(epoch, settings(false));
  cache.writePrivacySettingsCache(epoch, settings(true));
  assert.deepEqual(cache.readPrivacySettingsCache(epoch), settings(true));
  assert.deepEqual(plain(env.load(MODULE).readPrivacySettingsCache(epoch)), settings(true));
});

test('clearing removes the saved settings from disk as well', () => {
  const { env, epoch, cache } = setup();
  cache.writePrivacySettingsCache(epoch, settings(true));
  cache.clearPrivacySettingsCache(epoch);
  assert.equal(cache.readPrivacySettingsCache(epoch), null);
  assert.equal(env.load(MODULE).readPrivacySettingsCache(epoch), null);
});

test('switching account drops the previous account settings', () => {
  const { env, epoch, cache } = setup();
  cache.writePrivacySettingsCache(epoch, settings(false));
  const next = env.signIn('user-b');
  assert.equal(cache.readPrivacySettingsCache(next), null);
  // 旧 epoch 不再生效。
  assert.equal(cache.readPrivacySettingsCache(epoch), null);
});
