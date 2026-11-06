# R2 Media Origin Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Prepare the preproduction App build to accept the verified public R2 Worker and authorized private R2 S3 URLs before backend cutover.

**Architecture:** Extend the existing exact preproduction metadata and embedded-host contract. Keep peer-media authorization on its existing explicitly configured origins; retain COS/API origins for existing references and rollback. This code preparation does not merge, change repository variables, publish an APK, or switch backend storage.

**Tech Stack:** Existing Node test runner, JavaScript build verification and TypeScript peer-media helper tests.

## Global Constraints

- Keep API/chat at `https://api-43-134-85-95.sslip.io`.
- Required ordered media origins are COS, API, public Worker, R2 S3 API, exactly as shown below.
- Public Worker: `https://windnote-media-preprod-delivery.yiboding1998.workers.dev`.
- Private signed R2 API origin: `https://0bea489023c1d8692a19dadaf15dcf95.r2.cloudflarestorage.com`.
- Retain old COS and API origins; never allow a wildcard or arbitrary Cloudflare account/Worker.
- Preserve App identity, signing, distribution gates and old cache work in PR #341.
- No real keys, signed media URLs, object paths or private account data in tests/logs.
- No repository-variable, merge, build publication or backend/DB cutover in this task.

### Task 1: Exact build origins and client regression evidence

**Files:** `.github/scripts/verify-android-preprod.js`, `test/r2-media-origins.test.js`, `test/api-utils.test.js`, `docs/android-release.md`.

**Interfaces:** Existing exported `EXPECTED`, `preprodVersionCode`, `validateMetadata`, `validateApkContents` remain unchanged. `allowPeerMediaUrl` continues to consume `MEDIA_ORIGINS`; no runtime allowlist change is needed.

- [x] Add this complete focused build regression file:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
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
```

- [x] Run `node --test test/r2-media-origins.test.js` and observe four expected failures before changing the production verifier.
- [x] Preserve existing verifier structure and replace the two arrays with:

```js
mediaOrigins: Object.freeze([
  'https://windnote-preprod-tokyo-1447743949.cos.ap-tokyo.myqcloud.com',
  'https://api-43-134-85-95.sslip.io',
  'https://windnote-media-preprod-delivery.yiboding1998.workers.dev',
  'https://0bea489023c1d8692a19dadaf15dcf95.r2.cloudflarestorage.com',
]),
mediaHosts: Object.freeze([
  'windnote-preprod-tokyo-1447743949.cos.ap-tokyo.myqcloud.com',
  'api-43-134-85-95.sslip.io',
  'windnote-media-preprod-delivery.yiboding1998.workers.dev',
  '0bea489023c1d8692a19dadaf15dcf95.r2.cloudflarestorage.com',
]),
```

- [x] Extend the existing `test/api-utils.test.js` media-origin harness with configured origins from the exact list. Verify public Worker and signed R2 URLs are accepted, while a different Worker/account and suffix-host attacker are rejected. Use synthetic object keys/signatures only; do not change runtime authorization code.
- [x] Update the corresponding old two-origin expectations in preproduction tests only where the new contract changes the expected valid set. Keep missing-origin, ordering, identity and arbitrary-origin rejection coverage.
- [x] Update `docs/android-release.md` to show all four origins in that order, explain public Worker versus private signed API use, and require coordinated repository-variable/new APK verification before backend cutover. Keep the existing distribution gates and source retention. Installed old clients do not gain origins from a server switch.
- [x] Run `node --test test/r2-media-origins.test.js test/android-preprod-build-workflow.test.js test/android-preprod-identity.test.js test/android-release-workflow.test.js test/api-utils.test.js`, and focused lint/type checks appropriate to the unchanged runtime API. Report platform-only limits accurately; do not rewrite unrelated tooling.
- [ ] Review the scoped diff, commit only this task's files and plan updates, and obtain independent spec/quality and final integration review. The controller will update existing ready PR #341 and wait for CI before proposing a coordinated release.

## Implementation evidence (2026-11-05)

- Regression RED before verifier edits: 6 tests, 2 passing and 4 expected assertion failures (four-origin metadata accepted, legacy-only metadata rejected, and each new R2 APK host required).
- Regression GREEN after exact array update: 6/6 passing.
- Focused five-file preproduction/release/API suite: 65/65 passing, exit 0, with Windows Git Bash subprocess permission.
- Explicit TypeScript CLI with --noEmit: exit 0. Expo lint through its installed CLI: exit 0. Scoped changed-JavaScript ESLint with Node globals: exit 0.
- npm wrappers cannot find the worktree's absent Expo .bin shim; installed package entry points were used without changing tooling.
- Implementation and self-review complete; scoped commit prepared for controller's independent spec/quality and final integration review. No push, repository-variable changes, APK publication, or backend cutover performed.
