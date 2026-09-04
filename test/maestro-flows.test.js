const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const flowNames = [
  'smoke',
  'auth-navigation',
  'chat-message',
  'moment-lifecycle',
  'profile-settings',
  'social-circle',
];

test('six business flows are cross-platform and reference valid locators', () => {
  const contract = JSON.parse(
    fs.readFileSync(path.join(root, 'e2e', 'locator-contract.json'), 'utf8'),
  );
  const locatorBases = contract.locators.map((entry) => entry.id);

  for (const name of flowNames) {
    const filePath = path.join(root, '.maestro', 'flows', `${name}.yaml`);
    const source = fs.readFileSync(filePath, 'utf8');
    assert.match(source, /^appId: \$\{APP_ID\}/m, name);
    assert.doesNotMatch(source, /api\.windnote\.ai|windnote\.ai\/api/i, name);
    assert.doesNotMatch(source, /platform:\s*(android|ios)/i, name);

    const ids = [...source.matchAll(/id:\s*["']?(windnote\.[^\s"']+)/g)].map(
      (match) => match[1],
    );
    assert.ok(ids.length > 0, `${name} must use stable id selectors`);
    for (const id of ids) {
      assert.ok(
        locatorBases.some((base) => id === base || id.startsWith(`${base}.`)),
        `${name} uses an undeclared locator ${id}`,
      );
    }
  }
});

test('all referenced subflows exist and mutation flows carry the run id', () => {
  for (const name of flowNames) {
    const source = fs.readFileSync(
      path.join(root, '.maestro', 'flows', `${name}.yaml`),
      'utf8',
    );
    for (const match of source.matchAll(/file:\s+([^\s]+)/g)) {
      const referenced = path.resolve(root, '.maestro', 'flows', match[1]);
      assert.ok(fs.existsSync(referenced), `${name} references missing ${match[1]}`);
    }
  }

  for (const name of ['chat-message', 'moment-lifecycle', 'profile-settings']) {
    const source = fs.readFileSync(
      path.join(root, '.maestro', 'flows', `${name}.yaml`),
      'utf8',
    );
    assert.match(source, /\$\{E2E_RUN_ID\}/, name);
  }
});

test('shared sign-in chooses one explicit authentication mode', () => {
  const source = fs.readFileSync(
    path.join(root, '.maestro', 'subflows', 'sign-in.yaml'),
    'utf8',
  );
  assert.match(source, /E2E_AUTH_MODE == 'password'/);
  assert.match(source, /E2E_AUTH_MODE == 'verification-code'/);
  assert.match(source, /windnote\.auth\.login\.password-input/);
  assert.match(source, /windnote\.auth\.login\.code-input/);
  assert.match(source, /\$\{MAESTRO_E2E_PASSWORD\}/);
  assert.match(source, /\$\{MAESTRO_E2E_VERIFICATION_CODE\}/);
  assert.doesNotMatch(source, /\$\{E2E_PASSWORD\}/);
  assert.doesNotMatch(source, /\$\{E2E_VERIFICATION_CODE\}/);
});

test('every top-level flow attests the installed app target before continuing', () => {
  const launch = fs.readFileSync(
    path.join(root, '.maestro', 'subflows', 'launch.yaml'),
    'utf8',
  );
  assert.match(launch, /assertVisible:\s*\n\s+id:\s*["']?\$\{E2E_API_TARGET_ID\}/);

  for (const directory of ['flows', 'performance']) {
    const names = fs
      .readdirSync(path.join(root, '.maestro', directory))
      .filter((name) => name.endsWith('.yaml'));
    for (const name of names) {
      const source = fs.readFileSync(
        path.join(root, '.maestro', directory, name),
        'utf8',
      );
      const firstCommand = source.split('---')[1] ?? '';
      assert.match(
        firstCommand,
        /^\s*- runFlow:\s*\n\s+file:\s+\.\.\/subflows\/launch\.yaml/m,
        `${directory}/${name} must attest through launch before other commands`,
      );
    }
  }
});

test('Maestro eraseText counts stay within the documented CLI limit', () => {
  const yamlFiles = fs
    .readdirSync(path.join(root, '.maestro'), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.yaml'));
  for (const entry of yamlFiles) {
    const source = fs.readFileSync(path.join(entry.parentPath, entry.name), 'utf8');
    for (const match of source.matchAll(/eraseText:\s*(\d+)/g)) {
      assert.ok(Number(match[1]) <= 100, `${entry.name} eraseText exceeds 100`);
    }
  }
});
