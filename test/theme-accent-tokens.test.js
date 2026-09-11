const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

const tokens = loadTsModule('src/theme/tokens.ts');
const { iconForeground } = loadTsModule('src/theme/icon-color.ts', {
  requireShim: (id) => (id === './tokens' ? tokens : require(id)),
});
const { darkColors, lightColors } = loadTsModule('src/theme/colors.ts');

const read = (relative) =>
  fs.readFileSync(path.join(process.cwd(), relative), 'utf8');

test('暗色下的强调紫只有一支：iconAccent 与 tabBarActive 同值', () => {
  // 同一个「被点亮的紫」在一屏里出现两种深浅（tab 一种、图标另一种），
  // 用户只会当成渲染 bug。两个 token 必须是同一个常量。
  assert.equal(darkColors.iconAccent, darkColors.tabBarActive);
  assert.equal(darkColors.iconAccent, '#B18AFF');

  // 值只能写一次（DARK_ACCENT 常量），否则两个 token 会各自漂移。
  // 注释里提到色值不算。
  const source = read('src/theme/colors.ts');
  const assignments = source.match(/(?:[:=]\s*)'#B18AFF'/gi) ?? [];
  assert.deepEqual([...assignments], ["= '#B18AFF'"]);
});

test('浅色下强调图标沿用 primary，不另开一支色', () => {
  assert.equal(lightColors.iconAccent, lightColors.primary);
  assert.equal(lightColors.iconAccent, '#6366F1');
});

test('parseHexColor 认 #RRGGBB 与 #RGB，其余返回 null', () => {
  // loadTsModule 在独立 realm 里跑，返回值的原型不同源 —— 先摊平再断言。
  assert.deepEqual([...tokens.parseHexColor('#6366F1')], [99, 102, 241]);
  assert.deepEqual([...tokens.parseHexColor('#FFF')], [255, 255, 255]);
  assert.deepEqual([...tokens.parseHexColor('#1a2b3c')], [26, 43, 60]);

  assert.equal(tokens.parseHexColor('rgba(0, 0, 0, 0.4)'), null);
  assert.equal(tokens.parseHexColor('transparent'), null);
  assert.equal(tokens.parseHexColor('#12345'), null);
  assert.equal(tokens.parseHexColor('6366F1'), null);
});

test('withAlpha 与 iconForeground 共用同一份 hex 解析', () => {
  assert.equal(tokens.withAlpha('#6366F1', 0.12), 'rgba(99, 102, 241, 0.12)');
  // 三位 hex 以前被当成「非颜色」原样返回，现在两个派生函数都认得。
  assert.equal(tokens.withAlpha('#FFF', 0.5), 'rgba(255, 255, 255, 0.5)');
  assert.equal(tokens.withAlpha('rgba(0,0,0,0.4)', 0.5), 'rgba(0,0,0,0.4)');
});

test('iconForeground 只在暗色下按 0.4 混白，其余原样返回', () => {
  // 99 + (255-99)*0.4 = 161.4 -> 0xA1；102 -> 0xA3；241 -> 0xF7
  assert.equal(iconForeground('#6366F1', 'dark'), '#a1a3f7');
  // 每个通道单独补零：#0A0B0C 不能塌成 5 位。
  assert.equal(iconForeground('#0A0B0C', 'dark'), '#6c6d6d');
  assert.equal(iconForeground('#FFF', 'dark'), '#ffffff');
  assert.equal(iconForeground('#000', 'dark'), '#666666');

  assert.equal(iconForeground('#6366F1', 'light'), '#6366F1');
  // 服务端下发的任意颜色串没有可推导的安全亮度，原样透传而不是崩掉。
  assert.equal(iconForeground('rgba(0, 0, 0, 0.4)', 'dark'), 'rgba(0, 0, 0, 0.4)');
  assert.equal(iconForeground('tomato', 'dark'), 'tomato');
});

test('强调图标与紧挨着的标签必须同色，不能一个提亮一个不提亮', () => {
  // #231 只提亮了图标，旁边的标签仍是 colors.primary（暗色下约 3.8:1），
  // 于是同一个按钮里出现两种紫。扫全仓，防止下次再漏。
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.tsx')) inspect(full);
    }
  };
  const inspect = (file) => {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (!/color=\{[^}]*colors\.iconAccent/.test(line)) return;
      // 只看紧随其后的同级节点（下一个 JSX 元素开标签之前）。
      for (let i = index + 1; i < Math.min(lines.length, index + 5); i += 1) {
        if (/<(Pressable|View|Ionicons|Image)\b/.test(lines[i])) break;
        if (/colors\.primary\b/.test(lines[i])) {
          offenders.push(`${file}:${index + 1} -> :${i + 1}`);
        }
      }
    });
  };
  walk(path.join(process.cwd(), 'src'));

  assert.deepEqual(
    [...offenders],
    [],
    `这些 iconAccent 图标旁边还挂着 colors.primary 文字：\n${offenders.join('\n')}`,
  );
});

test('白底上的图标不走提亮：提亮紫在 #FFFFFF 上只有 2.6:1', () => {
  // FilterScreen 的 chipRemove 是白色圆底、ShareScreen 的分享按钮底也是
  // colors.white（两个主题同色）——这两处要的是深色前景，不是暗色提亮。
  const filter = read('src/features/discover/screens/FilterScreen.tsx');
  assert.match(filter, /chipRemove: \{ backgroundColor: colors\.white \}/);
  assert.doesNotMatch(
    filter,
    /<Ionicons name="close" size=\{13\} color=\{colors\.iconAccent\}/,
  );
  // clearBtn 是 primary 实心底、文字是白色：图标必须跟文字同色。
  assert.match(
    filter,
    /<Ionicons name="trash-outline" size=\{18\} color=\{colors\.white\} \/>/,
  );

  const share = read('src/features/profile/screens/ShareScreen.tsx');
  assert.doesNotMatch(share, /share-social-outline" size=\{18\} color=\{colors\.iconAccent\}/);
});

test('单卡色值只算一次：扩容档位与靓号页不再各自派生', () => {
  const expansion = read('src/features/profile/screens/GroupExpansionScreen.tsx');
  // 图标、价格、图标底色都从同一个 productTone 派生。
  assert.match(expansion, /const productTone = iconForeground\(/);
  assert.match(expansion, /color=\{productTone\}/);
  assert.match(expansion, /\{ color: productTone \}/);
  assert.doesNotMatch(expansion, /productColor/);

  // FancyNumber 用色板里钉好的 iconAccent，不在运行时把 token 过提亮公式。
  const fancy = read('src/features/profile/screens/FancyNumberScreen.tsx');
  assert.doesNotMatch(fancy, /iconForeground/);
  assert.match(fancy, /name="ribbon" size=\{22\} color=\{colors\.iconAccent\}/);
});
