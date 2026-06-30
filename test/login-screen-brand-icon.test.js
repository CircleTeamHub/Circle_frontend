const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

test('login screen uses the existing app logo plane asset without an app-icon frame', () => {
  const source = read('src/features/auth/screens/LoginScreen.tsx');

  assert.match(source, /APP_LOGO_SOURCE/);
  assert.match(source, /assets\/images\/login-logo-plane\.png/);
  assert.match(source, /<Image/);
  assert.match(source, /logoPlane/);
  assert.doesNotMatch(source, /Ionicons/);
  assert.doesNotMatch(source, /paper-plane/);
  assert.doesNotMatch(source, /logoShell/);
  assert.doesNotMatch(source, /logoOuter/);
  assert.doesNotMatch(source, /logoMiddle/);
  assert.doesNotMatch(source, /logoDot/);
});

test('login logo asset is transparent and does not carry the white app-icon background', () => {
  const { PNG } = require('pngjs');
  const bytes = fs.readFileSync(
    path.join(process.cwd(), 'assets/images/login-logo-plane.png'),
  );
  const image = PNG.sync.read(bytes);
  let visible = 0;
  let visibleWhite = 0;

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const i = (y * image.width + x) * 4;
      const r = image.data[i];
      const g = image.data[i + 1];
      const b = image.data[i + 2];
      const a = image.data[i + 3];
      if (a > 10) {
        visible += 1;
        if (r > 245 && g > 245 && b > 245) visibleWhite += 1;
      }
    }
  }

  assert.ok(visible > 50000);
  assert.equal(visibleWhite, 0);
  assert.equal(image.data[3], 0);
  assert.equal(image.data[(image.width - 1) * 4 + 3], 0);
  assert.equal(image.data[((image.height - 1) * image.width) * 4 + 3], 0);
  assert.equal(image.data[(image.height * image.width - 1) * 4 + 3], 0);
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
