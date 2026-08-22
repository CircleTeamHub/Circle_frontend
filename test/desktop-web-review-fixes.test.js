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
  assertOverrideWins('src/storage/encrypted-init.web.ts');
});

function assertOverrideWins(relative) {
  const source = read(relative);
  // localStorage 满时新 token 退到内存，但 read 先读 localStorage 的话
  // 返回的是上一个账号的旧 token —— 写入报告成功、读回来却是旧凭证。
  const readFn = /function read(?:Raw)?\(key: string\): string \| null \{[\s\S]*?\n\}/.exec(source);
  assert.ok(readFn, `${relative} 找不到 read()`);
  const overrideAt = readFn[0].indexOf('memoryFallback.get(key)');
  const storageAt = readFn[0].indexOf('ls.getItem');
  assert.ok(overrideAt > -1 && storageAt > -1);
  assert.ok(
    overrideAt < storageAt,
    `${relative}: read 必须先看内存覆盖，否则持久化失败后会复活旧值`,
  );
  // 落盘成功要撤掉覆盖，否则旧覆盖会一直遮住新的持久值。
  assert.match(
    source,
    /ls\.setItem\(PREFIX \+ key, value\);[\s\S]{0,160}memoryFallback\.delete\(key\);/,
    `${relative}: 落盘成功后没撤掉内存覆盖`,
  );
}

test('web auth credentials never persist in browser storage', () => {
  const source = read('src/storage/secure-kv.web.ts');

  assert.doesNotMatch(source, /\.setItem\(/);
  assert.match(source, /memoryStore\.set\(key, value\)/);
  assert.match(source, /ls\.removeItem\(PREFIX \+ key\)/);
  assert.match(source, /key\?\.startsWith\(PREFIX\)/);
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
test('Enter-to-send does not fire while an IME candidate is being confirmed', () => {
  const source = read('src/features/chat/screens/ChatDetailScreen.tsx');

  // 中日韩输入法用回车确认候选词，浏览器同样发一个 key='Enter' 的 keydown。
  // 不挡住的话，中文用户每选一次词就把半截草稿发出去 —— 这是这个 app 的
  // 主力输入方式，等于每句话都中招。
  const handler = /onKeyPress=\{[\s\S]*?: undefined\s*\n\s*\}/.exec(source);
  assert.ok(handler, '找不到 onKeyPress 处理器');
  assert.match(
    handler[0],
    /if \(native\.isComposing \|\| native\.keyCode === 229\) return;/,
    '缺少输入法合成态守卫',
  );
  // 守卫必须在 preventDefault 之前 —— 先 preventDefault 就把 RNW 自己那条
  // （同样带 !isComposing 判断的）submit 分支也一起绕过去了。
  const guardAt = handler[0].indexOf('native.keyCode === 229');
  const preventAt = handler[0].indexOf('event.preventDefault()');
  assert.ok(guardAt > -1 && preventAt > -1);
  assert.ok(guardAt < preventAt, '合成态守卫必须早于 preventDefault');
});

test('the QR polling key is redacted from dev logs', () => {
  const redact = read('src/utils/redact.ts');
  // 把 pollKey 从 URL 挪进 body 只挡住了访问日志那一路；dev 下 apiClient
  // 连请求体一起打印，不进脱敏名单等于换个地方继续泄漏同一把钥匙。
  assert.match(redact, /'qrtoken'/);
  assert.match(redact, /'pollkey'/);

  // 名单是小写比对的，写成驼峰会静默失效。
  const list = /const SENSITIVE_KEYS = new Set\(\[[\s\S]*?\]\)/.exec(redact);
  assert.ok(list);
  assert.doesNotMatch(list[0], /'pollKey'/);
});

test('the web upload path honors the caller-supplied timeout', () => {
  const source = read('src/services/api/upload.ts');

  // 视频那几个调用点传的是分钟级预算；web 分支丢掉它就退回 60 秒默认值 ——
  // 网页端发稍大的视频必然超时，而原生端同一个文件是好的，很难联想到是
  // 平台分支吃掉了参数。
  assert.match(
    source,
    /export async function uploadFileToPresignedUrl\([\s\S]{0,240}timeoutMs: number = UPLOAD_TIMEOUT_MS,/,
  );
  assert.match(
    source,
    /setTimeout\(\(\) => controller\.abort\(\), timeoutMs\)/,
    'presigned PUT 仍在用写死的 UPLOAD_TIMEOUT_MS',
  );
  const webBranch = /const blob = await readLocalBlobOnWeb\(fileUri\);[\s\S]*?\n    return;/.exec(
    source,
  );
  assert.ok(webBranch, '找不到 web 上传分支');
  assert.match(webBranch[0], /timeoutMs,/, 'web 分支没把 timeoutMs 透传下去');
});

test('deleting the open conversation collapses the split detail pane', () => {
  const source = read('src/features/messages/screens/MessagesScreen.tsx');

  // 不收回的话：左边的行没了，右边还挂着一段已被清空的聊天，
  // 往里发消息等于把会话原地复活。
  assert.match(
    source,
    /setEmbeddedChat\(\(current\) =>\s*\n?\s*current\?\.conversationID === conversation\.id \? null : current,/,
  );
  // 必须落在两个请求都成功之后 —— 删失败还收栏就是骗用户。
  const deleteFlow = /await updateChatConversationPreferences\(conversation\.id, \{[\s\S]*?\} catch \(err\)/.exec(
    source,
  );
  assert.ok(deleteFlow);
  assert.match(deleteFlow[0], /setEmbeddedChat/);
});

test('the QR pane expires on its own clock, not only on the server reply', () => {
  const source = read('src/features/auth/components/QrLoginPane.tsx');

  // 断网时每一发轮询都被 catch 吞掉，服务端那句 EXPIRED 永远送不到。
  assert.match(source, /const expiresAtMs = Date\.parse\(session\.expiresAt\)/);
  assert.match(
    source,
    /if \(Number\.isFinite\(expiresAtMs\) && expiresAtMs <= Date\.now\(\)\) \{[\s\S]{0,120}setStatus\('expired'\)/,
  );
  // 检查必须早于 inFlight 短路：离线时上一发请求可能一直挂着不回来。
  const tick = /const timer = setInterval\(async \(\) => \{[\s\S]*?inFlight = true;/.exec(
    source,
  );
  assert.ok(tick);
  assert.ok(
    tick[0].indexOf('expiresAtMs <= Date.now()') < tick[0].indexOf('if (inFlight) return;'),
    '有效期检查被挡在 inFlight 短路后面，离线时永远轮不到执行',
  );
});

test('the document language follows the selected locale on web', () => {
  const source = read('src/i18n/index.ts');

  // +html.tsx 是静态模板，SSG 出来的是同一份写死 lang="zh" 的 HTML。
  assert.match(source, /document\.documentElement\.lang = lng/);
  // 挂在 i18n 上而不是组件里：语言能从设置页/系统语言/存储回灌多处改。
  assert.match(source, /i18n\.on\('languageChanged', syncDocumentLang\)/);
  // 初值也要同步一次，否则首屏仍是模板里那个写死的值。
  assert.match(source, /syncDocumentLang\(i18n\.language\)/);
});

test('CI launches the client-only production export in a real browser', () => {
  const workflow = read('.github/workflows/ci.yml');
  const smoke = read('.github/scripts/smoke-web-export.js');

  // The app bootstraps auth and secure storage on the client; exporting a
  // server-rendered shell would reintroduce the production-only hydration
  // failure this smoke test is intended to catch.
  const appConfig = JSON.parse(read('app.json'));
  assert.equal(appConfig.expo.web.output, 'single');
  assert.match(workflow, /expo export --platform web/);
  assert.doesNotMatch(workflow, /--no-ssg/);
  assert.match(workflow, /EXPO_PUBLIC_API_URL: https:\/\/api\.web-export\.invalid/);
  assert.match(workflow, /node \.github\/scripts\/smoke-web-export\.js/);

  // Exercise both the entry route and a direct SPA deep link, and fail on
  // exceptions even when React still leaves markup behind in #root.
  assert.match(smoke, /'Runtime\.exceptionThrown'/);
  assert.match(smoke, /rootChildren/);
  assert.match(smoke, /\/qr-login\?token=/);
  assert.match(smoke, /path\.join\(DIST, 'index\.html'\)/);
});
