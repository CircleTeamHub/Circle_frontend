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

test('login screen uses a dark-mode form panel with full-height scroll content', () => {
  const source = read('src/features/auth/screens/LoginScreen.tsx');

  assert.match(source, /formPanel/);
  assert.match(source, /logoShell/);
  assert.match(source, /flexGrow:\s*1/);
  assert.match(source, /formPanel:\s*\{[\s\S]*borderWidth:\s*1/);
  assert.match(source, /formPanel:\s*\{[\s\S]*borderRadius:\s*Radius\.lg/);
  assert.match(source, /formPanel:\s*\{[\s\S]*padding:\s*Spacing\.lg/);
  assert.match(source, /formPanel:\s*\{[\s\S]*width:\s*"100%"/);
  assert.match(source, /formPanel:\s*\{[\s\S]*backgroundColor:\s*colors\.surface/);
  assert.match(source, /formPanel:\s*\{[\s\S]*borderColor:\s*colors\.surfaceBorder/);
  assert.match(source, /Math\.max\(insets\.bottom \+ 24,\s*40\)/);
});
