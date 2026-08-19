const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

// ---------------------------------------------------------------------------
// FE#92 忘记密码 + 回收站
// ---------------------------------------------------------------------------

test('忘记密码：登录页入口 → 独立页面 → 后端重置端点 (FE#92)', () => {
  const login = read('src/features/auth/screens/LoginScreen.tsx');
  assert.match(login, /router\.push\("\/\(auth\)\/forgot-password" as never\)/);
  assert.doesNotMatch(login, /forgotPasswordHint/);

  const screen = read('src/features/auth/screens/ForgotPasswordScreen.tsx');
  assert.match(screen, /useSendEmailCode\('reset-password'\)/);
  assert.match(screen, /resetPassword\(\{ email, code, newPassword \}\)/);

  const api = read('src/services/api/auth.ts');
  assert.match(api, /\/auth\/password\/reset-request/);
  assert.match(api, /\/auth\/password\/reset"/);

  // 发码 hook 的 reset-password 目的走独立端点
  const hook = read('src/hooks/use-send-email-code.ts');
  assert.match(hook, /'login' \| 'register' \| 'reset-password'/);
  assert.match(hook, /requestPasswordReset\(normalized\)/);

  // 路由文件存在
  assert.ok(fs.existsSync(path.join(process.cwd(), 'app/(auth)/forgot-password.tsx')));
});

test('忘记密码 review 修复：6 位码校验 + 同步在飞守卫 + 直达回退 (review)', () => {
  const screen = read('src/features/auth/screens/ForgotPasswordScreen.tsx');
  // 提交前走共享校验契约（6 位码）——4/5 位残码不再打到后端烧限流配额
  assert.match(screen, /validateEmail\(email\) \?\? validateCode\(code\)/);
  // 快速双击不双发（state disabled 等重渲染，ref 同步生效）
  assert.match(screen, /const submitInFlightRef = useRef\(false\)/);
  assert.match(screen, /submitInFlightRef\.current = true;/);
  assert.match(screen, /submitInFlightRef\.current = false;/);
  // 深链直达（栈里没有登录页）时 back() 是 no-op → 回退 replace 到登录页
  assert.match(screen, /router\.canGoBack\(\)/);
  assert.match(screen, /router\.replace\('\/\(auth\)\/login'\)/);
});

test('重置凭据在 dev 日志中被脱敏（code / newPassword）(review)', () => {
  const { redactSensitiveFields } = loadTsModule('src/utils/redact.ts');
  const redacted = redactSensitiveFields({
    email: 'a@b.com',
    code: '123456',
    newPassword: 'hunter2-new',
  });
  const plain = JSON.parse(JSON.stringify(redacted));
  assert.equal(plain.code, '[REDACTED]');
  assert.equal(plain.newPassword, '[REDACTED]');
  assert.equal(plain.email, 'a@b.com');
});

test('回收站：列表 + 恢复接线 (FE#92)', () => {
  const api = read('src/services/api/notes.ts');
  assert.match(api, /\/note\/recycle-bin/);
  assert.match(api, /\/note\/\$\{id\}\/restore/);

  const screen = read('src/features/notes/screens/RecycleBinScreen.tsx');
  assert.match(screen, /fetchDeletedNotes/);
  assert.match(screen, /restoreNote\(note\.id\)/);

  const notesScreen = read('src/features/notes/screens/NotesScreen.tsx');
  assert.match(notesScreen, /profile\/notes\/recycle-bin/);
  assert.ok(
    fs.existsSync(
      path.join(process.cwd(), 'app/(tabs)/profile/notes/recycle-bin.tsx'),
    ),
  );
});

// ---------------------------------------------------------------------------
// #91 幂等头 / #100 卡片回执
// ---------------------------------------------------------------------------

test('membership upgrade 走客服协助流程，不再在 app 内直接升级（review 二轮）', () => {
  // app 内直接 POST /membership/upgrade（含幂等键）的流程已下线，改为「联系客服开通/升级」。
  // 旧测试仍要求已删除的 upgradeMembership + 屏幕接线，会确定性失败——重写为覆盖新流程。
  const api = read('src/services/api/membership.ts');
  assert.doesNotMatch(api, /export async function upgradeMembership/);

  const screen = read('src/features/profile/screens/MemberCenterScreen.tsx');
  // 升级动作 = 打开与会员客服的会话，而不是直接调用升级接口 / 造幂等键。
  // 客服账号来自后端下发的 membership 类，不再是编译期变量。
  assert.match(screen, /selectSupportAgents\(config, 'membership'\)/);
  assert.doesNotMatch(screen, /upgradeMembership\(/);
  assert.doesNotMatch(screen, /resolveMembershipUpgradeIdempotency\(/);
});

test('转账只做扣款，卡片回执整套挂账已出清', () => {
  // #100 那套「客户端发卡 → 回执置位 cardDeliveredAt → 阻止补偿 cron」的前提是
  // 卡片由客户端发。自研聊天栈把 transfer-card 收成服务端专属类型后，发卡 100%
  // 被拒 —— 回执分支从来没被执行过。卡片改由后端结算后签发，这套全部删掉。
  const composer = read('src/features/chat/screens/TransferComposerScreen.tsx');
  // 幂等键仍然要有：它防的是「同一笔转账被重复扣款」，与卡片无关。
  assert.match(composer, /idempotencyKey: idempotency\.key/);
  assert.doesNotMatch(composer, /useTransferComposerStore/);

  const api = read('src/services/api/coin.ts');
  assert.doesNotMatch(api, /card-sent/);
  assert.doesNotMatch(api, /markGiftCardSent/);
});

test('回收站：恢复成功与刷新失败分离；刷新失败可感知 (round 2)', () => {
  const screen = read('src/features/notes/screens/RecycleBinScreen.tsx');
  // 恢复失败先 return —— 之后的列表刷新失败绝不再弹「恢复失败」
  const restore = screen.slice(
    screen.indexOf('const handleRestore'),
    screen.indexOf('const d = useMemo'),
  );
  assert.match(restore, /restoreFailedTitle[\s\S]*return;/);
  // 服务端已恢复：本地先移行，刷新失败静默保留
  assert.match(restore, /setNotes\(\(prev\) => prev\.filter/);
  // 下拉刷新失败被捕获并提示（不再 unhandled rejection）
  const refresh = screen.slice(
    screen.indexOf('const handleRefresh'),
    screen.indexOf('const closeMenu'),
  );
  assert.match(refresh, /catch[\s\S]*refreshFailedTitle/);
});

test('忘记密码提交前校验密码长度（round 2）', () => {
  const screen = read('src/features/auth/screens/ForgotPasswordScreen.tsx');
  assert.match(
    screen,
    /validateEmail\(email\) \?\? validateCode\(code\) \?\? validatePassword\(newPassword\)/,
  );
});

// ---------------------------------------------------------------------------
// #89 / #116
// ---------------------------------------------------------------------------

test('朋友圈新帖检测已是广播驱动，无常驻定时器 (#89 终态钉死)', () => {
  const feed = read('src/features/discover/components/moments-feed.tsx');
  // 广播信号订阅 + 回前台补查兜底；30s 轮询（setInterval）不允许回归
  assert.match(feed, /useMomentsFeedSignalStore/);
  assert.match(feed, /AppState\.addEventListener\('change'/);
  assert.doesNotMatch(feed, /setInterval/);
});

test('空 cities = 未设置 = 不匹配任何城市筛选 (#116 语义钉死)', () => {
  const filter = read('src/features/discover/utils/circle-filter.ts');
  assert.match(filter, /#116/);

  const mod = loadTsModule('src/features/discover/utils/circle-filter.ts', {
    requireShim: (specifier) => {
      throw new Error(`unexpected import: ${specifier}`);
    },
  });
  // review 修复：直接调用真实导出 applyCircleFilter，断言强制执行 ——
  // 旧的回退名单一个都不匹配，行为断言整段被静默跳过，
  // 「空 cities 匹配上选中城市」的回归照样能过 CI。
  assert.equal(typeof mod.applyCircleFilter, 'function');
  const circles = [
    { id: 'a', cities: ['上海'] },
    { id: 'b', cities: [] },
  ];
  const result = mod.applyCircleFilter(circles, {
    circleIds: [],
    cities: ['上海'],
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.map((c) => c.id))),
    ['a'],
  );
  // 无筛选时全量放行（回归护栏）
  const unfiltered = mod.applyCircleFilter(circles, {
    circleIds: [],
    cities: [],
  });
  assert.equal(unfiltered.length, 2);
});
