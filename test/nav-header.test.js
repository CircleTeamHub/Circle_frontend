const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('nav header guards back navigation when there is no previous screen', () => {
  const filePath = path.join(
    process.cwd(),
    'src/components/ui/nav-header.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /useNavigation/);
  assert.match(source, /fallbackHref\?: Href/);
  assert.match(source, /if \(navigation\.canGoBack\(\)\) \{/);
  assert.match(source, /router\.back\(\);/);
  assert.match(source, /else if \(fallbackHref\) \{/);
  assert.match(source, /router\.replace\(fallbackHref\);/);
  assert.doesNotMatch(source, /onPress=\{\(\) => router\.back\(\)\}/);
});

test('nav header lets screens override the back action explicitly', () => {
  const filePath = path.join(
    process.cwd(),
    'src/components/ui/nav-header.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /onBackPress\?: \(\) => void;/);
  assert.match(source, /if \(onBackPress\) \{/);
  assert.match(source, /onBackPress\(\);/);
});
