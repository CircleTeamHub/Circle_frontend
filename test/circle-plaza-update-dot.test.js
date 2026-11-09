const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('点飞机 tab 时收红点并拉一次最新列表，其它 tab 不受影响', () => {
  const layout = read('app/(tabs)/_layout.tsx');
  assert.match(
    layout,
    /tabPress: \(\) => \{\s*if \(route\.name === 'discover'\) openCirclePlazaUpdate\(\);/,
  );
});

test('屏幕阅读器也能知道飞机 tab 有更新', () => {
  const layout = read('app/(tabs)/_layout.tsx');
  assert.match(layout, /t\('tabs\.hasUpdate'\)/);
});

test('发帖通知已下线：五种语言都不再有这条文案，也不再说会弹横幅', () => {
  for (const locale of ['zh', 'en', 'ja', 'ko', 'es']) {
    const text = read(`src/i18n/locales/${locale}.json`);
    assert.doesNotMatch(text, /CIRCLE_POST_PUBLISHED/, locale);
  }
  assert.doesNotMatch(read('src/i18n/locales/zh.json'), /新活动会弹横幅/);
  assert.doesNotMatch(read('src/i18n/locales/en.json'), /pop up as a banner/);
});
