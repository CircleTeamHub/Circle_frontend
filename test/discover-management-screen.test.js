const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('circle management panel exposes joined created managed applied tabs in order', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/discover/components/my-circles-panel.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

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
    const source = fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
    assert.match(
      source,
      /"discover":\s*\{[\s\S]*?"myManaged":\s*"/,
      `${relativePath} should define discover.myManaged`,
    );
  }
});
