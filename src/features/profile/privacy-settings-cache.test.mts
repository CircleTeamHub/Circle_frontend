import assert from 'node:assert/strict';
import test from 'node:test';

import {
  readPrivacySettingsCache,
  writePrivacySettingsCache,
} from './privacy-settings-cache.ts';

const settings = (showWechat: boolean) => ({ showWechat }) as never;

test('nothing is cached before the first load', () => {
  assert.equal(readPrivacySettingsCache(1), null);
});

test('the next visit reads back the last saved settings', () => {
  writePrivacySettingsCache(2, settings(false));
  writePrivacySettingsCache(2, settings(true));
  assert.deepEqual(readPrivacySettingsCache(2), settings(true));
});

test('switching account drops the previous account settings', () => {
  writePrivacySettingsCache(3, settings(false));
  assert.equal(readPrivacySettingsCache(4), null);
  // 切回旧账号也不复活:epoch 一变就丢掉。
  assert.equal(readPrivacySettingsCache(3), null);
});
