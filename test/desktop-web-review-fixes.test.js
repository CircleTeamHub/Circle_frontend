const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 桌面网页版 review 批的回归守卫。这里每一条都对应一个"看不出来但确实坏了"
// 的缺陷：尺寸算错、入口消失、边界用错基准、旧值复活。
const read = (relative) =>
  fs.readFileSync(path.join(process.cwd(), relative), 'utf8');

test('discover image sizing follows the centered column, not the viewport', () => {
  // useWindowDimensions 在网页版报的是 1440 的浏览器视口，而内容实际待在
  // 640 的居中栏里：单图会算到 ~890、相册网格 ~1300，直接溢出栏外。
  for (const relative of [
    'src/features/discover/components/image-grid.tsx',
    'src/features/discover/components/moment-album-row.tsx',
  ]) {
    const source = read(relative);
    assert.match(source, /useContentColumnWidth\(\)/, relative);
    assert.doesNotMatch(
      source,
      /useWindowDimensions/,
      `${relative} 退回了视口宽度，桌面网页版会溢出居中栏`,
    );
  }

  const column = read('src/components/app/desktop-centered-column.tsx');
  assert.match(column, /ContentColumnWidthContext\.Provider value=\{COLUMN_MAX_WIDTH\}/);
  // 栏外（原生 / 窄窗）必须回落到视口宽，否则手机端全按 640 排版。
  assert.match(column, /return column \?\? width;/);
});

test('an image-only album post still has a way into its detail page', () => {
  const source = read('src/features/discover/components/moment-album-row.tsx');
  // 正文为空 + 没有评论时，正文链接不渲染、图片被大图查看器接管、
  // 点赞评论块整块不显示 —— 时间戳这行是最后的入口。
  assert.match(
    source,
    /<Pressable\s+style=\{s\.footerRow\}\s+onPress=\{\(\) => onPress\(post\.id\)\}/,
  );
  assert.match(source, /accessibilityLabel=\{t\('moment\.openDetail'/);
});

test('selects keep a focus indicator even though text inputs drop theirs', () => {
  const source = read('app/+html.tsx');
  // 文本框有光标指示焦点，下拉没有：把它一起摘掉，键盘用户 tab 进来
  // 完全看不出焦点在哪一个 select 上。
  assert.match(source, /select:focus-visible \{\s*\n\s*outline: 2px solid currentColor;/);
  assert.doesNotMatch(
    source,
    /select:focus[,\s]*\n[^}]*outline: none/,
    'select 的焦点指示被一起摘掉了',
  );
});

test('zoom panning is bounded by the rendered image, not the container', () => {
  const source = read('src/components/ui/zoomable-image.tsx');
  // contentFit="contain"：竖图放进横屏容器时两侧都是空白，按容器宽算的
  // 边界允许把照片拖到几乎完全离屏，屏幕上只剩黑边。
  assert.match(source, /const renderedExtent = useCallback/);
  assert.match(source, /Math\.min\(width \/ n\.w, height \/ n\.h\)/);
  assert.match(source, /clampTranslate\([\s\S]{0,80}extent\.w/);
  assert.match(source, /clampTranslate\([\s\S]{0,80}extent\.h/);
  // 固有尺寸来自 onLoad；拿不到时退回容器尺寸（等于旧行为，不崩）。
  assert.match(source, /onLoad=\{\(event\) =>/);
  assert.match(source, /if \(!n \|\| n\.w <= 0 \|\| n\.h <= 0\) return \{ w: width, h: height \}/);
});

test('a failed persistent write is not shadowed by the stale stored value', () => {
  const source = read('src/storage/secure-kv.web.ts');
  // localStorage 满时新 token 退到内存，但 read 先读 localStorage 的话
  // 返回的是上一个账号的旧 token —— 写入报告成功、读回来却是旧凭证。
  const readFn = /function read\(key: string\): string \| null \{[\s\S]*?\n\}/.exec(source);
  assert.ok(readFn, '找不到 read()');
  const overrideAt = readFn[0].indexOf('memoryFallback.get(key)');
  const storageAt = readFn[0].indexOf('ls.getItem');
  assert.ok(overrideAt > -1 && storageAt > -1);
  assert.ok(
    overrideAt < storageAt,
    'read 必须先看内存覆盖，否则持久化失败后会复活旧凭证',
  );
  // 落盘成功要撤掉覆盖，否则旧覆盖会一直遮住新的持久值。
  assert.match(
    source,
    /ls\.setItem\(PREFIX \+ key, value\);[\s\S]{0,120}memoryFallback\.delete\(key\);/,
  );
});

test('a failed QR finalization leaves the pane recoverable', () => {
  const pane = read('src/features/auth/components/QrLoginPane.tsx');
  // 不等收尾结果的话：轮询已停、二维码还亮着，用户对着一张永远不会生效的
  // 码干等。后端那边失败时会把消费位回滚，前端不给出路就白回滚了。
  assert.match(pane, /const ok = await onTokensRef\.current\(result\.tokens\)/);
  assert.match(pane, /if \(!ok\) setStatus\('failed'\)/);
  assert.match(pane, /\}\) => Promise<boolean>;/);

  const auth = read('src/hooks/use-auth.ts');
  assert.match(auth, /completeQrLogin[\s\S]{0,120}Promise<boolean>/);
  assert.match(auth, /await onAuthSuccess\(tokens\);\s*\n\s*return true;/);
});

test('the cross-origin save fallback can tell an opened tab from a blocked one', () => {
  const source = read('src/utils/save-image.web.ts');
  // window.open 带 noopener/noreferrer 时规范规定返回 null —— 拿它判断成败
  // 会把"新标签打开了"报成保存失败。
  assert.doesNotMatch(source, /window\.open\([^)]*noopener/);
  assert.match(source, /const opened = window\.open\(url, '_blank'\);/);
  assert.match(source, /opened\.opener = null;/);
});
