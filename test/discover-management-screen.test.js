const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

test('circle management panel exposes joined created managed applied tabs in order', () => {
  const source = read('src/features/discover/components/my-circles-panel.tsx');

  assert.match(
    source,
    /const CIRCLE_TAB_KEYS = \["joined", "created", "managed", "applied"\] as const;/,
  );
  assert.match(source, /t\('discover\.myManaged'\)/);
});

test('discover locales include myManaged copy for the circle management tab', () => {
  const localeFiles = [
    'src/i18n/locales/zh.json',
    'src/i18n/locales/en.json',
  ];

  for (const relativePath of localeFiles) {
    const source = read(relativePath);
    assert.match(
      source,
      /"discover":\s*\{[\s\S]*?"myManaged":\s*"/,
      `${relativePath} should define discover.myManaged`,
    );
  }
});

test('circle management entry points use encoded string hrefs for circle detail navigation', () => {
  const panel = read('src/features/discover/components/my-circles-panel.tsx');
  assert.match(
    panel,
    /router\.push\(`\/\(tabs\)\/discover\/circle\/\$\{encodeURIComponent\(item\.id\)\}`\)/,
  );
  assert.doesNotMatch(
    panel,
    /router\.push\(\{\s*pathname: ['"]\/\(tabs\)\/discover\/circle\/\[id\]['"]/,
  );

  const screen = read('src/features/discover/screens/MyCirclesScreen.tsx');
  assert.match(
    screen,
    /router\.push\(`\/\(tabs\)\/discover\/circle\/\$\{encodeURIComponent\(id\)\}`\)/,
  );
  assert.doesNotMatch(
    screen,
    /router\.push\(\{\s*pathname: ['"]\/\(tabs\)\/discover\/circle\/\[id\]['"]/,
  );
});
