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
});
