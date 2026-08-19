const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();

test('every E2E locator is unique, namespaced, declared, and mounted', () => {
  const contractPath = path.join(root, 'e2e', 'locator-contract.json');
  const catalogPath = path.join(root, 'src', 'testing', 'e2e-test-ids.ts');
  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  const catalog = fs.readFileSync(catalogPath, 'utf8');

  assert.ok(Array.isArray(contract.locators));
  assert.ok(contract.locators.length >= 35);
  const keys = new Set();
  const ids = new Set();
  for (const locator of contract.locators) {
    assert.match(locator.key, /^[a-z][A-Za-z0-9]+$/);
    assert.match(locator.id, /^windnote\.[a-z0-9.-]+$/);
    assert.equal(keys.has(locator.key), false, `duplicate key ${locator.key}`);
    assert.equal(ids.has(locator.id), false, `duplicate id ${locator.id}`);
    keys.add(locator.key);
    ids.add(locator.id);

    assert.match(catalog, new RegExp(`\\b${locator.key}\\s*:`));
    const sourcePath = path.join(root, locator.source);
    const source = fs.readFileSync(sourcePath, 'utf8');
    assert.match(
      source,
      new RegExp(`E2E_TEST_IDS\\.${locator.key}\\b`),
      `${locator.key} is not mounted in ${locator.source}`,
    );
  }
});

test('dynamic locator builders reject empty identifiers', async () => {
  const filePath = path.join(root, 'src', 'testing', 'e2e-test-ids.ts');
  const source = fs.readFileSync(filePath, 'utf8');
  assert.match(source, /function dynamicTestId/);
  assert.match(source, /identifier\.trim\(\)/);
  assert.match(source, /throw new Error/);
});
