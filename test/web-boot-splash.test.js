const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const token = (colors, theme, name) =>
  new RegExp(`export const ${theme}[\\s\\S]*?\\n  ${name}: '(#[0-9A-Fa-f]{6})'`).exec(colors)?.[1];

test('the shell paints a splash before the bundle arrives', () => {
  const shell = read('public/index.html');
  // 添加到主屏幕的网页 App 是独立的数据区，首次打开要重新下载整个主包。
  // WebKit 在脚本还在下载、页面又「看起来是空的」时不提交首帧，深色模式下就是一片黑。
  // 一张大于 32×32 的图片能让页面算作非空，立即画出来。
  const root = /<div id="root">([\s\S]*?)\n    <\/div>\n  <\/body>/.exec(shell);
  assert.ok(root, '找不到 #root');
  assert.match(root[1], /<div id="boot-splash">/, '#root 里没有启动画面');
  const icon = /<img src="([^"]+)" width="(\d+)" height="(\d+)"/.exec(root[1]);
  assert.ok(icon, '启动画面没有图片，WebKit 不会提前画出首帧');
  assert.ok(Number(icon[2]) > 32 && Number(icon[3]) > 32, '图片不超过 32×32，WebKit 不算非空');
  assert.ok(fs.existsSync(path.join(process.cwd(), 'public', icon[1])), `${icon[1]} 不存在`);
});

test('the splash matches the app background in both color schemes', () => {
  const shell = read('public/index.html');
  const colors = read('src/theme/colors.ts');
  const light = token(colors, 'lightColors', 'background');
  const dark = token(colors, 'darkColors', 'background');
  const primary = /const PRIMARY = '(#[0-9A-Fa-f]{6})'/.exec(colors)?.[1];
  assert.ok(light && dark && primary, 'colors.ts 里找不到 background / PRIMARY');
  // 交接给 App 时底色不跳：浅色 #F8F9FA，深色纯黑；转圈与 App 加载态同色。
  assert.match(shell, new RegExp(`#boot-splash \\{[^}]*background-color: ${light};`, 'i'));
  assert.match(
    shell,
    new RegExp(`prefers-color-scheme: dark\\) \\{\\s*#boot-splash \\{\\s*background-color: ${dark};`, 'i'),
  );
  assert.match(shell, new RegExp(`\\.boot-spinner \\{[^}]*border-top-color: ${primary};`, 'i'));
});
