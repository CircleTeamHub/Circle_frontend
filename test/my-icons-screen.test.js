const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('MyIconsScreen loads icon options and enforces the 5 icon limit', () => {
  const src = read('src/features/profile/screens/MyIconsScreen.tsx');

  assert.match(src, /fetchIconOptions/);
  assert.match(src, /updateDisplayIcons/);
  assert.match(src, /fetchCurrentUser/);
  assert.match(src, /const refreshedUser = await fetchCurrentUser\(\)/);
  // 上限提示已 i18n 化（key + 插值 count），文案在 locale 文件中。
  assert.match(src, /t\('myIcons\.maxIcons'/);
  assert.doesNotMatch(src, /保存成功/);
  assert.match(src, /systemIcons/);
  assert.match(src, /circleIcons/);

  const en = JSON.parse(read('src/i18n/locales/en.json'));
  const zh = JSON.parse(read('src/i18n/locales/zh.json'));
  assert.equal(zh.myIcons.maxIcons, '最多展示 {{count}} 个图标');
  assert.ok(en.myIcons.maxIcons.includes('{{count}}'));
});

test('MyIconsScreen shows a concise explanation and earning condition for the tapped badge', () => {
  const src = read('src/features/profile/screens/MyIconsScreen.tsx');

  assert.match(src, /focusedOption/);
  assert.match(src, /setFocusedOption\(option\)/);
  // 说明文案改为返回 i18n key 段，文案在 locale 文件中（多语言）。
  assert.match(src, /getIconExplanationKey/);
  assert.match(src, /myIcons\.explainIntroLabel/);
  assert.match(src, /myIcons\.explainConditionLabel/);
  assert.match(src, /VIP/);
  assert.match(src, /NEW_USER/);
  assert.match(src, /TOP_COLLABORATOR/);
  assert.match(src, /VERIFIED_PROFILE/);
  assert.match(src, /CIRCLE_BUILDER/);

  // 每个 badge 的说明在两种语言里都齐全。
  const en = JSON.parse(read('src/i18n/locales/en.json'));
  const zh = JSON.parse(read('src/i18n/locales/zh.json'));
  const keys = [
    'empty',
    'circle',
    'vip',
    'newUser',
    'topCollaborator',
    'verifiedProfile',
    'circleBuilder',
    'systemDefault',
  ];
  for (const k of keys) {
    for (const locale of [en, zh]) {
      assert.ok(locale.myIcons.explain[k].description, `${k}.description`);
      assert.ok(locale.myIcons.explain[k].condition, `${k}.condition`);
    }
  }
  assert.match(zh.myIcons.explain.circle.description, /圈子专属/);
});
