const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

test('login screen renders only the paper plane mark without an app-icon frame', () => {
  const source = read('src/features/auth/screens/LoginScreen.tsx');

  assert.match(source, /Ionicons/);
  assert.match(source, /name="paper-plane"/);
  assert.match(source, /logoPlane/);
  assert.doesNotMatch(source, /APP_ICON_SOURCE/);
  assert.doesNotMatch(source, /<Image/);
  assert.doesNotMatch(source, /logoShell/);
  assert.doesNotMatch(source, /logoOuter/);
  assert.doesNotMatch(source, /logoMiddle/);
  assert.doesNotMatch(source, /logoDot/);
});

test('login screen keeps the original form layout below the logo', () => {
  const source = read('src/features/auth/screens/LoginScreen.tsx');

  assert.doesNotMatch(source, /formPanel/);
  assert.doesNotMatch(source, /flexGrow:\s*1/);
  assert.doesNotMatch(source, /container:\s*\{[^}]*justifyContent:\s*"center"/);
  assert.doesNotMatch(source, /Math\.max\(insets\.bottom \+ 24,\s*40\)/);
  assert.match(source, /container:\s*\{\s*paddingHorizontal:\s*Spacing\.lg,\s*alignItems:\s*"center",\s*gap:\s*28\s*\}/);
  assert.match(source, /paddingBottom:\s*insets\.bottom \+ 24/);
  assert.match(source, /segment:\s*\{\s*backgroundColor:\s*colors\.surface\s*\}/);
});
