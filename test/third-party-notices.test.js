const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const read = (relativePath) =>
  fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

function runNpm(args) {
  const command = process.platform === 'win32' ? process.env.ComSpec : 'npm';
  const commandArgs =
    process.platform === 'win32'
      ? ['/d', '/s', '/c', ['npm.cmd', ...args].join(' ')]
      : args;
  return spawnSync(command, commandArgs, {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
}

test('production dependency tree does not contain the removed OpenIM SDK', () => {
  const result = runNpm([
    'ls',
    '--omit=dev',
    '--all',
    '--json',
    '--long',
    '--package-lock-only',
    '--loglevel=silent',
  ]);
  assert.ok(result.stdout?.trim(), result.stderr || result.error || 'npm ls returned no JSON');
  const tree = JSON.parse(result.stdout);
  const names = new Set();
  const walk = (node) => {
    for (const [name, child] of Object.entries(node.dependencies ?? {})) {
      names.add(name);
      walk(child);
    }
  };
  walk(tree);

  assert.ok(names.size > 100, 'production dependency tree is unexpectedly small');
  assert.equal(names.has('@openim/rn-client-sdk'), false);
});

test('license artifacts are deterministic, complete, and machine-readable', () => {
  for (const relativePath of [
    'scripts/generate-third-party-notices.mjs',
    'assets/legal/THIRD_PARTY_NOTICES.txt',
    'assets/legal/third-party-notices.json',
    'assets/legal/cyclonedx-sbom.json',
  ]) {
    assert.ok(fs.existsSync(path.join(process.cwd(), relativePath)), relativePath);
  }

  const notices = read('assets/legal/THIRD_PARTY_NOTICES.txt');
  const bundled = JSON.parse(read('assets/legal/third-party-notices.json'));
  const sbom = JSON.parse(read('assets/legal/cyclonedx-sbom.json'));

  assert.match(notices, /^WindNote third-party software notices/m);
  assert.match(notices, /@blocknote\/core@0\.47\.3/);
  assert.doesNotMatch(notices, /\r/, 'notices must be LF-only on every runner OS');
  assert.doesNotMatch(notices, /^License:\s*(?:UNKNOWN|UNLICENSED)\s*$/im);
  assert.doesNotMatch(notices, /^@openim\/rn-client-sdk@/m);
  assert.equal(bundled.text, notices);

  assert.equal(sbom.bomFormat, 'CycloneDX');
  assert.equal(sbom.specVersion, '1.5');
  assert.equal(sbom.metadata.component.version, '1.0.1');
  assert.ok(sbom.components.length > 100);
  const componentNames = new Set(sbom.components.map((component) => component.name));
  for (const platformPackage of [
    '@sentry/cli-linux-x64',
    '@sentry/cli-win32-x64',
    'lightningcss-linux-x64-gnu',
    'lightningcss-win32-x64-msvc',
  ]) {
    assert.ok(
      componentNames.has(platformPackage),
      `SBOM must be independent of the generator host: ${platformPackage}`,
    );
  }
  assert.equal(
    sbom.components.some((component) => component.name === '@openim/rn-client-sdk'),
    false,
  );
  for (const component of sbom.components) {
    assert.ok(component.name);
    assert.match(component.version, /^\S+$/);
    const licenseChoice = component.licenses?.[0];
    assert.ok(
      licenseChoice?.license?.id ||
        licenseChoice?.license?.name ||
        licenseChoice?.expression,
      `${component.name}@${component.version} is missing license metadata`,
    );
    for (const reference of component.externalReferences ?? []) {
      const parsed = new URL(reference.url);
      assert.match(reference.type, /^(?:distribution|vcs|website)$/);
      assert.equal(parsed.protocol, 'https:');
      assert.equal(parsed.username, '');
      assert.equal(parsed.password, '');
    }
  }
  const refs = sbom.components.map((component) => component['bom-ref']);
  assert.deepEqual(refs, [...refs].sort());

  const check = runNpm(['run', 'licenses:check']);
  assert.equal(check.status, 0, `${check.stdout}\n${check.stderr}`);
});

test('the About screen exposes bundled selectable third-party notices', () => {
  const versionScreen = read('src/features/profile/screens/AboutVersionScreen.tsx');
  const licenseScreen = read(
    'src/features/profile/screens/ThirdPartyLicensesScreen.tsx',
  );
  const route = read('app/(tabs)/profile/settings-about-licenses.tsx');

  assert.match(versionScreen, /settings-about-licenses/);
  assert.match(versionScreen, /settingsDetails\.about\.thirdPartyLicenses/);
  assert.match(licenseScreen, /third-party-notices\.json/);
  assert.match(licenseScreen, /selectable/);
  assert.match(route, /ThirdPartyLicensesScreen/);

  for (const locale of ['zh', 'en', 'ja', 'ko', 'es']) {
    const messages = JSON.parse(read(`src/i18n/locales/${locale}.json`));
    assert.ok(messages.settingsDetails.about.thirdPartyLicenses, locale);
    assert.ok(messages.settingsDetails.about.thirdPartyLicensesDescription, locale);
  }
});
