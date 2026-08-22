const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 网页扫码登录的传输面守卫。
//
// pollKey 是把网页会话换成 access/refresh 令牌的那把钥匙。它一旦进了 URL，
// 就会沿「开发日志 → 反代访问日志 → 异常上报里的 request.url」一路留痕，
// 而两边的脱敏名单都不认识这个参数名 —— 捡到日志的人可以在用户确认之后
// 抢先兑换。顺带的第二个问题：GET 是可缓存的，APPROVED 那一次响应带着
// 令牌，被任何一层缓存留下就等于把「一次性交付」变成可重放。
const read = (relative) =>
  fs.readFileSync(path.join(process.cwd(), relative), 'utf8');

const CLIENT = 'src/services/api/qr-login.ts';

const pollBody = (source) => {
  const block = /export function pollQrLoginStatus[\s\S]*?\n\}/.exec(source);
  assert.ok(block, '找不到 pollQrLoginStatus');
  return block[0];
};

test('the poll key travels in the body, never in the URL', () => {
  // 只看函数体：上方注释里留着旧写法的字面量做说明，不该被当成回归。
  const body = pollBody(read(CLIENT));

  assert.doesNotMatch(
    body,
    /\?key=/,
    'pollKey 回到了 query string —— 它是能换走会话的凭证，不能进 URL',
  );
  assert.doesNotMatch(body, /encodeURIComponent\(pollKey\)/);
  assert.match(body, /\{ method: 'POST', body: \{ pollKey \} \}/);
});

test('every qr-login call that can carry tokens is a POST', () => {
  const source = read(CLIENT);
  // 创建（返回 pollKey）与轮询（APPROVED 时返回令牌）都不能是可缓存的 GET。
  assert.match(source, /'\/auth\/qr-login', \{ method: 'POST' \}/);
  assert.match(pollBody(source), /method: 'POST'/);
});

// 前后端靠三条路径字符串对齐，改一边另一边不会报警（改词的教训见
// realtime close code 那次）。后端并排检出时把它们真比一遍。
const BACKEND_CONTROLLER = path.join(
  process.cwd(),
  '..',
  'circle_be',
  'src/auth/auth.controller.ts',
);
const hasBackend = fs.existsSync(BACKEND_CONTROLLER);
// CI 检出的后端是「同名分支，没有就 main」。扫码登录跨两个仓，只要有一侧
// 还没合进 main，被检出的那份后端就可能整个没有这些端点 —— 那不是漂移，
// 是配对未完成。这种情况诚实地跳过；后端有了端点却对不上才是要报的红。
const backendHasQrLogin =
  hasBackend && /qr-login/.test(fs.readFileSync(BACKEND_CONTROLLER, 'utf8'));
const skipReason = !hasBackend
  ? 'circle_be not checked out beside circle-im'
  : !backendHasQrLogin
    ? '被检出的后端还没有扫码登录端点（跨仓 PR 未配对/未合并）'
    : false;

test(
  'every qr-login route the client calls exists on the backend',
  { skip: skipReason },
  () => {
    const backend = fs.readFileSync(BACKEND_CONTROLLER, 'utf8');
    const client = read(CLIENT);

    // 客户端里的 `/auth/qr-login...` 字面量 → 后端的 @Post('qr-login...')。
    // 只认带引号/反引号包裹的完整字面量，别把注释里的文件路径也捞进来。
    const routes = [
      ...client.matchAll(/['`]\/auth\/(qr-login[^'`]*)['`]/g),
    ].map((m) => m[1].replace(/\$\{[^}]*\}/g, ':token'));
    assert.ok(routes.length >= 3, `只解析到 ${routes.length} 条路由`);

    for (const route of new Set(routes)) {
      assert.match(
        backend,
        new RegExp(`@Post\\('${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'\\)`),
        `后端没有 @Post('${route}') —— 前端会 404`,
      );
    }

    // 带令牌的两个响应都得禁缓存。
    assert.match(backend, /@Header\('Cache-Control', 'no-store'\)/);
  },
);
