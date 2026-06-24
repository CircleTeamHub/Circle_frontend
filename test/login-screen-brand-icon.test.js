const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

test('login screen renders the shared app icon image instead of the old drawn logo', () => {
  const source = read('src/features/auth/screens/LoginScreen.tsx');

  assert.match(source, /require\(["']\.\.\/\.\.\/\.\.\/\.\.\/assets\/images\/icon\.png["']\)/);
  assert.match(source, /<Image[\s\S]*source=\{APP_ICON_SOURCE\}/);
  assert.doesNotMatch(source, /logoOuter/);
  assert.doesNotMatch(source, /logoMiddle/);
  assert.doesNotMatch(source, /logoDot/);
});
