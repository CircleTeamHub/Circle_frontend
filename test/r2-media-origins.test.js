const test = require('node:test');
const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const { EXPECTED, preprodVersionCode, validateMetadata, validateApkContents } =
  require('../.github/scripts/verify-android-preprod');
const origins = [
  'https://windnote-preprod-tokyo-1447743949.cos.ap-tokyo.myqcloud.com',
  'https://api-43-134-85-95.sslip.io',
  'https://windnote-media-preprod-delivery.yiboding1998.workers.dev',
  'https://0bea489023c1d8692a19dadaf15dcf95.r2.cloudflarestorage.com',
];
function metadata(mediaOrigins) {
  const versionCode = preprodVersionCode(4321);
  return {
    app: { version: EXPECTED.version, name: EXPECTED.appName,
      android: { package: EXPECTED.packageName, versionCode },
      extra: { appVariant: EXPECTED.appVariant } },
    env: { ANDROID_PREPROD_VERSION_CODE: String(versionCode),
      EXPO_PUBLIC_API_URL: EXPECTED.apiUrl,
      EXPO_PUBLIC_CHAT_WS_URL: EXPECTED.apiUrl,
      EXPO_PUBLIC_MEDIA_ORIGINS: mediaOrigins.join(',') },
  };
}
test('preproduction metadata accepts both R2 origins and retains old delivery', () => {
  assert.deepEqual(validateMetadata(metadata(origins)), []);
});
test('preproduction metadata rejects a legacy-only build before R2 cutover', () => {
  assert.ok(validateMetadata(metadata(origins.slice(0, 2)))
    .some((message) => message.includes('EXPO_PUBLIC_MEDIA_ORIGINS')));
});
test('preproduction metadata rejects an extra untrusted origin', () => {
  assert.ok(validateMetadata(metadata([...origins, 'https://untrusted.example']))
    .some((message) => message.includes('EXPO_PUBLIC_MEDIA_ORIGINS')));
});
const hosts = origins.map((origin) => new URL(origin).hostname);
test('APK origin verification accepts the complete migration host set', () => {
  assert.deepEqual(validateApkContents(Buffer.from(hosts.join('\n'))), []);
});
for (const requiredHost of hosts.slice(2)) {
  test(`APK origin verification rejects missing ${requiredHost}`, () => {
    const bytes = Buffer.from(hosts.filter((host) => host !== requiredHost).join('\n'));
    assert.ok(validateApkContents(bytes).some((message) => message.includes(requiredHost)));
  });
}
