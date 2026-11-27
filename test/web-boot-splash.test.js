const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const token = (colors, theme, name) =>
  new RegExp(`export const ${theme}[\\s\\S]*?\\n  ${name}: '(#[0-9A-Fa-f]{6})'`).exec(colors)?.[1];
const themeBackgrounds = () => {
  const colors = read('src/theme/colors.ts');
  return { light: token(colors, 'lightColors', 'background'), dark: token(colors, 'darkColors', 'background') };
};

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

test('the page and the splash follow the app background in both color schemes', () => {
  const shell = read('public/index.html');
  const { light, dark } = themeBackgrounds();
  const primary = /const PRIMARY = '(#[0-9A-Fa-f]{6})'/.exec(read('src/theme/colors.ts'))?.[1];
  assert.ok(light && dark && primary, 'colors.ts 里找不到 background / PRIMARY');
  // 页面底色决定 iOS 状态栏和 Safari 工具栏的颜色：留白的话深色模式下顶上一条是白的。
  assert.match(shell, new RegExp(`html,\\s*body,\\s*#boot-splash \\{\\s*background-color: ${light};`, 'i'));
  assert.match(
    shell,
    new RegExp(`prefers-color-scheme: dark\\) \\{\\s*html,\\s*body,\\s*#boot-splash \\{\\s*background-color: ${dark};`, 'i'),
  );
  assert.match(shell, new RegExp(`\\.boot-spinner \\{[^}]*border-top-color: ${primary};`, 'i'));
});

test('home-screen metadata is in the static shell, not injected after the bundle runs', () => {
  const shell = read('public/index.html');
  // 页面停在恢复页、或主包还没跑完时添加到主屏幕，JS 注入的 manifest / 图标还不在，
  // 桌面图标会退成一个字母。
  assert.match(shell, /<link rel="manifest" href="\/manifest\.webmanifest" \/>/);
  assert.match(shell, /<link rel="apple-touch-icon" href="\/icons\/windnote-192\.png" \/>/);
  // 不写这个，iOS 添加到主屏幕时不会去取启动图（iOS 27.2 模拟器实测）。
  assert.match(shell, /<meta name="apple-mobile-web-app-capable" content="yes" \/>/);
  assert.match(shell, /<meta name="mobile-web-app-capable" content="yes" \/>/);
  const title = read('src/components/app/web-document-title.tsx');
  assert.doesNotMatch(title, /rel="manifest"|apple-touch-icon/, '外壳已经写了，JS 再注入一份会重复');
});

test('every startup image matches its device and theme', () => {
  const shell = read('public/index.html');
  const backgrounds = themeBackgrounds();
  const links = [...shell.matchAll(/<link rel="apple-touch-startup-image" media="([^"]+)" href="([^"]+)" \/>/g)];
  assert.ok(links.length >= 20, `启动图太少：${links.length}`);
  const seen = new Map();
  for (const [, media, href] of links) {
    const width = Number(/device-width: (\d+)px/.exec(media)?.[1]);
    const height = Number(/device-height: (\d+)px/.exec(media)?.[1]);
    const scale = Number(/-webkit-device-pixel-ratio: (\d+)/.exec(media)?.[1]);
    const theme = /prefers-color-scheme: (light|dark)/.exec(media)?.[1];
    assert.ok(width && height && scale && theme, `媒体查询不完整：${media}`);
    // iOS 只认像素尺寸完全一致的启动图，差一个像素就退回纯色。
    const png = PNG.sync.read(fs.readFileSync(path.join(process.cwd(), 'public', href)));
    assert.equal(`${png.width}x${png.height}`, `${width * scale}x${height * scale}`, href);
    const corner = `#${[0, 1, 2].map(c => png.data[c].toString(16).padStart(2, '0')).join('')}`;
    assert.equal(corner.toUpperCase(), backgrounds[theme].toUpperCase(), `${href} 的底色和主题不一致`);
    const key = `${width}x${height}@${scale}`;
    seen.set(key, [...(seen.get(key) ?? []), theme]);
  }
  for (const [key, themes] of seen) assert.deepEqual(themes.sort(), ['dark', 'light'], `${key} 缺浅色或深色`);
});
