const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

test('iOS release workflow keeps build and TestFlight submission separate', () => {
  const workflow = read('.github/workflows/ios-release.yml');
  assert.match(workflow, /name: iOS Build and TestFlight/);
  assert.match(workflow, /group: circle-ios-release/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /eas-cli@latest build --platform ios --profile production/);
  assert.ok(workflow.includes('npx eas-cli@latest submit --platform ios --path "$RUNNER_TEMP/ios-release/circle-im.ipa" --non-interactive'));
  assert.match(workflow, /Validate iOS native configuration/);
  assert.match(workflow, /verify-ios-sentry-config\.js/);
  assert.match(workflow, /name: ios-release-\$\{\{ github\.sha \}\}/);
  assert.match(workflow, /shasum -a 256/);
});

test('EAS production profile uses remote version allocation and iOS resources', () => {
  const eas = JSON.parse(read('eas.json'));
  assert.equal(eas.cli.appVersionSource, 'remote');
  assert.equal(eas.build.production.autoIncrement, true);
  assert.equal(eas.build.production.ios.resourceClass, 'm-medium');
});

test('TestFlight inspection fails closed without Apple group configuration', () => {
  const result = spawnSync(process.execPath, ['scripts/inspect-testflight-groups.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { PATH: process.env.PATH },
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Missing iOS inspection configuration/);
});

test('TestFlight inspection workflow passes App Store Connect credentials by environment', () => {
  const workflow = read('.github/workflows/ios-testflight-inspection.yml');
  assert.match(workflow, /APP_STORE_CONNECT_API_KEY_ID/);
  assert.match(workflow, /APP_STORE_CONNECT_API_ISSUER_ID/);
  assert.match(workflow, /APP_STORE_CONNECT_API_KEY_BASE64/);
  assert.match(workflow, /IOS_TESTFLIGHT_GROUP_IDS/);
  assert.match(workflow, /RELEASE_FEISHU_WEBHOOK_URL/);
  assert.match(workflow, /scripts\/inspect-testflight-groups\.mjs/);
});
