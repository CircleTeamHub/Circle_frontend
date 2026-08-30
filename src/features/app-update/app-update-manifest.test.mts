import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isAndroidUpdateAvailable,
  parseGitHubReleaseManifest,
} from './app-update-manifest.ts';

const releaseManifest = {
  schemaVersion: 1,
  version: '1.2.3',
  versionCode: 1_002_003,
  apkUrl:
    'https://github.com/CircleTeamHub/windnote-releases/releases/download/v1.2.3/windnote.apk',
  sha256: 'c'.repeat(64),
  sizeBytes: 123_456,
};

test('parses the release.json asset published beside the official APK', () => {
  assert.deepEqual(parseGitHubReleaseManifest(releaseManifest), releaseManifest);
});

test('rejects malformed fields, inconsistent version codes, and unofficial APK paths', () => {
  for (const candidate of [
    { ...releaseManifest, version: '1.2.3-beta.1' },
    { ...releaseManifest, versionCode: 1_002_004 },
    { ...releaseManifest, sha256: 'not-a-sha256' },
    { ...releaseManifest, sizeBytes: 0 },
    { ...releaseManifest, apkUrl: 'https://attacker.example/windnote.apk' },
    {
      ...releaseManifest,
      apkUrl: releaseManifest.apkUrl.replace('v1.2.3', 'v1.2.4'),
    },
  ]) {
    assert.throws(
      () => parseGitHubReleaseManifest(candidate),
      /invalid GitHub release manifest/i,
    );
  }
});

test('offers an update only for a strictly newer positive version code', () => {
  const manifest = parseGitHubReleaseManifest(releaseManifest);

  assert.equal(isAndroidUpdateAvailable(1_002_002, manifest), true);
  assert.equal(isAndroidUpdateAvailable(1_002_003, manifest), false);
  assert.equal(isAndroidUpdateAvailable(1_002_004, manifest), false);
  assert.equal(isAndroidUpdateAvailable(0, manifest), false);
});
