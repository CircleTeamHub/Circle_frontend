const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 笔记卡片在网页端的可操作语义。
//
// 卡片内部有三个真按钮（「更多」+ 两个来源 chip），而 react-native-web 会把
// accessibilityRole="button" 渲染成**真的 <button> 元素**，所以外层不能再顶
// 这个角色 —— button 套 button 会触发 React DOM 告警、点击路由也会乱。
//
// 解法是一层铺满整卡、**没有子节点**的覆盖按钮：它是真 <button>（Tab 停得下、
// Enter/Space 走浏览器原生激活、读屏念得出「按钮」），而卡内那三个按钮是它的
// 兄弟节点，结构上不可能嵌套。
const read = (relative) =>
  fs.readFileSync(path.join(process.cwd(), relative), 'utf8');

const CARD = 'src/features/notes/components/NoteCard.tsx';

test('the web card exposes one childless overlay button, not a role on the wrapper', () => {
  const source = read(CARD);

  // 覆盖按钮：自闭合（没有子节点 = 不可能再套进一个 button）+ 铺满整卡。
  const overlay = /<Pressable\s+style=\{StyleSheet\.absoluteFill\}[\s\S]*?\/>/.exec(
    source,
  );
  assert.ok(overlay, '找不到铺满整卡的覆盖按钮');
  assert.match(overlay[0], /accessibilityRole="button"/);
  assert.doesNotMatch(
    overlay[0],
    /<\/Pressable>/,
    '覆盖按钮必须自闭合：一旦有子节点，卡内的真按钮就会嵌套进 <button> 里',
  );
  // 它得渲染在内容之前 —— 绘制层在内容之下，鼠标点击路径才不变。
  assert.match(
    source,
    /StyleSheet\.absoluteFill\}[\s\S]*?\/>\s*\n\s*\)\s*:\s*null\}\s*\n\s*<View style=\{s\.topRow\}>/,
    '覆盖按钮必须排在 topRow 之前',
  );

  // 外层：web 上不再是 button，否则又变回嵌套。
  assert.match(source, /accessibilityRole=\{isWeb \? undefined : accessibilityRole\}/);
});

test('the card has exactly one keyboard stop on web', () => {
  const source = read(CARD);
  // RNW 的 Pressable 默认 focusable：不显式退出 tab 序列的话，外层这个没有
  // 角色的 div 也会是一个停靠点，每张卡片要按两次 Tab。
  assert.match(
    source,
    /tabIndex=\{isWeb \? -1 : undefined\}/,
    '外层没让出 tab 停靠点，键盘用户每张卡片要按两次 Tab',
  );
});

test('selection state rides in the accessible name, not accessibilityState', () => {
  const source = read(CARD);
  // RNW 0.21 的 createDOMProps 完全不认 accessibilityState（源码零命中），
  // 写了不会变成任何 aria-*；而 aria-selected 不是 role="button" 的合法属性。
  assert.match(source, /notes\.list\.selectedCardA11y/);
  assert.match(source, /notes\.list\.unselectedCardA11y/);
  assert.match(source, /accessibilityLabel=\{overlayLabel\}/);

  // accessibilityState 只许留在原生那一侧（它在原生上是生效的）。
  const overlay = /<Pressable\s+style=\{StyleSheet\.absoluteFill\}[\s\S]*?\/>/.exec(
    source,
  );
  assert.doesNotMatch(
    overlay[0],
    /accessibilityState/,
    'accessibilityState 在 web 上是死代码，别挂到覆盖按钮上',
  );
});

test('both selection-state strings exist in every locale', () => {
  for (const locale of ['zh', 'en', 'ja', 'ko', 'es']) {
    const dict = JSON.parse(read(`src/i18n/locales/${locale}.json`));
    for (const key of ['selectedCardA11y', 'unselectedCardA11y']) {
      const value = dict.notes?.list?.[key];
      assert.equal(typeof value, 'string', `${locale} 缺 notes.list.${key}`);
      assert.match(value, /\{\{title\}\}/, `${locale} 的 ${key} 少了 title 占位`);
    }
  }
});
