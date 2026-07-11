const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
}

test('circle guide color legend maps to the same accent colors as the activity card', () => {
  const src = read('src/features/discover/screens/CircleGuideScreen.tsx');
  // 色块必须与 plaza-post-card 强调竖条一一对应：紫 primary / 绿 success / 橙 warning。
  assert.match(src, /colorPurple', color: colors\.primary/);
  assert.match(src, /colorGreen', color: colors\.success/);
  assert.match(src, /colorOrange', color: colors\.warning/);
});

test('circle guide screen renders the four play steps', () => {
  const src = read('src/features/discover/screens/CircleGuideScreen.tsx');
  for (const key of ['step1', 'step2', 'step3', 'step4']) {
    assert.match(src, new RegExp(`discover\\.guide\\.${key}`));
  }
});

test('circle settings screen links to the guide screen', () => {
  const settings = read(
    'src/features/discover/screens/CircleNotificationSettingsScreen.tsx',
  );
  assert.match(settings, /discover\.guide\.title/);
  assert.match(settings, /router\.push\('\/\(tabs\)\/discover\/guide'\)/);
});

test('discover guide route re-exports the guide screen', () => {
  const route = read('app/(tabs)/discover/guide.tsx');
  assert.match(route, /CircleGuideScreen/);
});

test('every locale defines the full circle guide content', () => {
  const KEYS = [
    'title',
    'entryHint',
    'intro',
    'colorsTitle',
    'colorsIntro',
    'colorPurple',
    'colorGreen',
    'colorOrange',
    'stepsTitle',
    'step1',
    'step2',
    'step3',
    'step4',
  ];
  for (const lng of ['en', 'zh', 'ja', 'ko', 'es']) {
    const json = JSON.parse(read(`src/i18n/locales/${lng}.json`));
    const guide = json.discover && json.discover.guide;
    assert.ok(guide, `${lng} missing discover.guide`);
    for (const k of KEYS) {
      assert.ok(
        typeof guide[k] === 'string' && guide[k].length > 0,
        `${lng} missing discover.guide.${k}`,
      );
    }
  }
});
