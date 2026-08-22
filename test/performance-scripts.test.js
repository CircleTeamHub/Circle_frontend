const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();

test('Android collector selects one device and captures frames, memory, crashes, and optional Perfetto', () => {
  const source = fs.readFileSync(path.join(root, 'scripts', 'perf-android.ps1'), 'utf8');
  for (const fragment of [
    'PERF_RESULTS_DIR',
    'PERF_DEVICE_ID',
    'gfxinfo',
    'meminfo',
    'logcat',
    'PERF_CAPTURE_PERFETTO',
    'perfetto',
    'performance-report.mjs',
    'MAESTRO_DEVICE_ID',
  ]) {
    assert.match(source, new RegExp(fragment), fragment);
  }
  assert.match(source, /devices\.Count -ne 1/);
});

test('iOS collector requires macOS, explicit simulator, xctrace, and exports raw artifacts', () => {
  const source = fs.readFileSync(path.join(root, 'scripts', 'perf-ios.sh'), 'utf8');
  for (const fragment of [
    'Darwin',
    'PERF_RESULTS_DIR',
    'PERF_DEVICE_ID',
    'xcrun xctrace record',
    'Animation Hitches',
    'xcrun xctrace export',
    'performance-report.mjs',
    'MAESTRO_DEVICE_ID',
  ]) {
    assert.match(source, new RegExp(fragment), fragment);
  }
});

test('three performance flows are shared and use bounded repeats plus stable locators', () => {
  const contract = JSON.parse(
    fs.readFileSync(path.join(root, 'e2e', 'locator-contract.json'), 'utf8'),
  );
  const bases = contract.locators.map((entry) => entry.id);
  const names = [
    'conversation-list-scroll',
    'chat-history-scroll',
    'conversation-switch-storm',
  ];
  for (const name of names) {
    const source = fs.readFileSync(
      path.join(root, '.maestro', 'performance', `${name}.yaml`),
      'utf8',
    );
    assert.match(source, /^appId: \$\{APP_ID\}/m, name);
    assert.match(source, /repeat:/, name);
    assert.match(source, /times:\s+(?:10|20)/, name);
    assert.match(source, /windnote\./, name);
    assert.doesNotMatch(source, /platform:\s*(android|ios)/i, name);
    for (const match of source.matchAll(/id:\s*([\w.${}-]+)/g)) {
      const id = match[1].replace(/\$\{[^}]+\}/g, 'fixture');
      assert.ok(
        bases.some((base) => id === base || id.startsWith(`${base}.`)),
        `${name} uses undeclared locator ${match[1]}`,
      );
    }
  }
});
