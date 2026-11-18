const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

test('circle management panel exposes all joined created managed applied tabs in order', () => {
  const source = read('src/features/discover/components/my-circles-panel.tsx');

  assert.match(
    source,
    /const CIRCLE_TAB_KEYS = \["all", "joined", "created", "managed", "applied"\] as const;/,
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

test('circle management entry points open circle detail in the current tab stack', () => {
  // 「我的圈子」在每个 tab 栈都有一份:圈子详情走 getCircleDetailHref(scope, …) 开在本栈,
  // 不再写死圈子栈(跨栈 push 的话返回会落到圈子 tab 的首页)。
  const panel = read('src/features/discover/components/my-circles-panel.tsx');
  assert.match(panel, /const scope = getUserProfileScopeFromSegments\(useSegments\(\)\);/);
  assert.match(panel, /router\.push\(getCircleDetailHref\(scope, item\.id\)\)/);
  assert.match(panel, /router\.push\(`\/\(tabs\)\/\$\{scope\}\/create-circle`\)/);
  assert.doesNotMatch(panel, /\/\(tabs\)\/discover\/circle\//);

  const screen = read('src/features/discover/screens/MyCirclesScreen.tsx');
  assert.match(screen, /const scope = getUserProfileScopeFromSegments\(segments\);/);
  assert.match(screen, /router\.push\(getCircleDetailHref\(scope, id\)\)/);
  assert.doesNotMatch(screen, /\/\(tabs\)\/discover\/circle\//);
});
