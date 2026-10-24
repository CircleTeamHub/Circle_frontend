const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 发热回归:tab 页和栈里的页面切走后并不卸载,没冻结的话每条消息、每次 store 写入
// 都还在后台重渲染。所有导航器统一开 freezeOnBlur。
// 注意它管不到「紧挨在当前页下面」的那一页(原生栈为右滑返回特意不冻),那种页面
// 由 useStoreWhileActive 自己停订阅,见 messages-screen.test.js。
test('every navigator layout freezes screens that are not visible', () => {
  const appDir = path.join(__dirname, '..', 'app');
  const layouts = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === '_layout.tsx') layouts.push(full);
    }
  };
  walk(appDir);

  const navigators = layouts.filter((file) =>
    /<(Stack|Tabs)\b/.test(fs.readFileSync(file, 'utf8')),
  );
  assert.ok(navigators.length >= 5, 'expected the app stacks and tabs to be found');
  for (const file of navigators) {
    const source = fs.readFileSync(file, 'utf8');
    assert.match(
      source,
      /screenOptions=\{\{[\s\S]*?freezeOnBlur: true/,
      `${path.relative(path.join(__dirname, '..'), file)} must set freezeOnBlur: true`,
    );
  }
});
