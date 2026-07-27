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
  assert.equal(zh.myIcons.maxIcons, '最多展示 {{count}} 个徽章');
  assert.ok(en.myIcons.maxIcons.includes('{{count}}'));
});

test('MyIconsScreen is titled 我的徽章 (badges), not 我的图标 (icons)', () => {
  const en = JSON.parse(read('src/i18n/locales/en.json'));
  const zh = JSON.parse(read('src/i18n/locales/zh.json'));
  assert.equal(zh.myIcons.title, '我的徽章');
  assert.doesNotMatch(zh.myIcons.title, /图标/);
  // 入口按钮与页面标题措辞对齐（都指向「徽章」）。
  assert.match(en.myIcons.title, /badge/i);
});

test('Badge detail sheet shows a concise explanation and earning condition for the tapped badge', () => {
  const sheet = read('src/features/profile/components/badge-detail-sheet.tsx');

  assert.match(sheet, /myIcons\.explainIntroLabel/);
  assert.match(sheet, /myIcons\.explainConditionLabel/);
  assert.match(sheet, /myIcons\.explain\.\$\{badge\.explainKey\}\.description/);
  assert.match(sheet, /myIcons\.explain\.\$\{badge\.explainKey\}\.condition/);
  // VIP 按当前档位（silver/gold/diamond/super）展示不同介绍。
  assert.match(sheet, /badge\.tierKey/);
  assert.match(sheet, /myIcons\.explain\.vip\.tiers\.\$\{badge\.tierKey\}\.description/);

  // systemKey → 说明 key 的映射覆盖全部系统徽章类型。
  const catalog = read('src/features/profile/badge-catalog.ts');
  assert.match(catalog, /getSystemExplanationKey/);
  for (const key of [
    'VIP',
    'NEW_USER',
    'TOP_COLLABORATOR',
    'VERIFIED_PROFILE',
    'CIRCLE_BUILDER',
  ]) {
    assert.match(catalog, new RegExp(key));
  }

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

  // VIP 四档各自的介绍 / 获得条件齐全，且不再用错误的「1-5」表述。
  for (const tier of ['silver', 'gold', 'diamond', 'super']) {
    for (const locale of [en, zh]) {
      assert.ok(
        locale.myIcons.explain.vip.tiers[tier].description,
        `vip.tiers.${tier}.description`,
      );
      assert.ok(
        locale.myIcons.explain.vip.tiers[tier].condition,
        `vip.tiers.${tier}.condition`,
      );
    }
  }
  assert.doesNotMatch(zh.myIcons.explain.vip.condition, /1-5/);
});

test('Badge detail hero renders at a native large size (no upscaled blur)', () => {
  const sheet = read('src/features/profile/components/badge-detail-sheet.tsx');
  const iconRow = read('src/components/ui/user-icon-row.tsx');

  // 详情大图按目标尺寸原生渲染，而非把小图 transform 放大（放大导致位图糊）。
  assert.match(sheet, /size=\{72\}/);
  assert.doesNotMatch(sheet, /scale:\s*1\.7/);
  // UserIconBadge 支持显式像素尺寸。
  assert.match(iconRow, /size\?: number/);
  assert.match(iconRow, /hasExplicitSize/);
});

test('MyIconsScreen shows all badges grouped by owned and locked', () => {
  const src = read('src/features/profile/screens/MyIconsScreen.tsx');

  // 三段：已拥有(系统) / 圈子徽章(单独分区) / 未拥有。
  assert.match(src, /t\('myIcons\.ownedGroup'/);
  assert.match(src, /t\('myIcons\.circleGroup'/);
  assert.match(src, /t\('myIcons\.lockedGroup'/);
  assert.match(src, /buildOwnedSystemBadges/);
  assert.match(src, /buildCircleBadges/);
  assert.match(src, /buildLockedBadges/);
  // 未拥有 = 系统徽章目录 − 已拥有系统类型。
  assert.match(src, /SYSTEM_BADGE_CATALOG\.filter\([\s\S]*ownedSystemKeys\.has/);
  // 点击任意徽章打开详情。
  assert.match(src, /onPress=\{setDetailBadge\}/);
  assert.match(src, /<BadgeDetailSheet/);

  // 全量系统徽章目录含 5 个类型。
  const catalog = read('src/features/profile/badge-catalog.ts');
  for (const key of [
    'VIP',
    'NEW_USER',
    'TOP_COLLABORATOR',
    'VERIFIED_PROFILE',
    'CIRCLE_BUILDER',
  ]) {
    assert.match(catalog, new RegExp(`systemKey: '${key}'`));
  }

  // 拥有 / 未拥有的名称文案在两语言中齐全。
  const en = JSON.parse(read('src/i18n/locales/en.json'));
  const zh = JSON.parse(read('src/i18n/locales/zh.json'));
  for (const locale of [en, zh]) {
    assert.ok(locale.myIcons.ownedGroup);
    assert.ok(locale.myIcons.circleGroup);
    assert.ok(locale.myIcons.lockedGroup);
    for (const k of [
      'vip',
      'newUser',
      'topCollaborator',
      'verifiedProfile',
      'circleBuilder',
    ]) {
      assert.ok(locale.myIcons.lockedName[k], `lockedName.${k}`);
    }
  }
});

test('BadgeGridItem renders a locked state and a "displaying" marker', () => {
  const item = read('src/features/profile/components/badge-grid-item.tsx');

  assert.match(item, /lock-closed/); // 未拥有锁标
  assert.match(item, /badge\.owned/); // 灰态判断
  assert.match(item, /displayingLabel/); // 展示中标记
});

test('MyIconsScreen distinguishes VIP badge variants with the same system key', () => {
  const src = read('src/features/profile/screens/MyIconsScreen.tsx');
  const types = read('src/types/index.ts');
  const api = read('src/services/api/icons.ts');

  assert.match(types, /systemVariant\?: string/);
  assert.match(api, /systemVariant\?: string/);
  assert.match(src, /systemVariant/);
  assert.match(src, /system:\$\{option\.systemKey\}:\$\{option\.systemVariant/);
  assert.match(src, /system:\$\{icon\.systemKey\}:\$\{icon\.systemVariant/);
  assert.match(src, /systemVariant: option\.systemVariant/);
});

test('MyIconsScreen preserves saved icon selections when refreshed user data is stale', () => {
  const src = read('src/features/profile/screens/MyIconsScreen.tsx');
  const saveBlock = src.match(
    /const handleSave = useCallback\([\s\S]*?\}, \[router, selectedIcons, setUser, user, t\]\);/,
  )?.[0] ?? '';

  assert.match(saveBlock, /const nextDisplayIcons = await updateDisplayIcons\(payload\)/);
  assert.match(saveBlock, /const refreshedUser = await fetchCurrentUser\(\)/);
  assert.match(saveBlock, /displayIcons:\s*nextDisplayIcons/);
  assert.doesNotMatch(saveBlock, /displayIcons:\s*refreshedUser\?\.displayIcons\s*\?\?\s*nextDisplayIcons/);
});

test('MyIconsScreen saves the current selection when leaving with the back button', () => {
  const src = read('src/features/profile/screens/MyIconsScreen.tsx');

  assert.match(src, /<NavHeader[\s\S]*onBackPress=\{handleSave\}/);
});
