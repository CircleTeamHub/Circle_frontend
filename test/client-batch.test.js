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

test('membership upgrade 幂等键跟随升级意图存活（review P1）', () => {
  const api = read('src/services/api/membership.ts');
  const upgradeBlock = api.slice(api.indexOf('export async function upgradeMembership'));
  // 键由调用方传入（重试间复用）；缺省才现造（向后兼容）
  assert.match(upgradeBlock, /idempotencyKey\?: string/);
  assert.match(
    upgradeBlock,
    /'Idempotency-Key': idempotencyKey \?\? generateIdempotencyKey\(\)/,
  );

  // 意图级持键：同一等级重试复用同一枚键，换等级/成功后换新键
  const mod = loadTsModule('src/features/profile/membership-idempotency.ts', {
    requireShim: (specifier) => {
      if (specifier === '@/utils/idempotency-key') {
        let seq = 0;
        return { generateIdempotencyKey: () => `key-${(seq += 1)}` };
      }
      throw new Error(`unexpected import: ${specifier}`);
    },
  });
  const first = mod.resolveMembershipUpgradeIdempotency(null, { level: 2 });
  // 响应丢失后的重试：同意图 → 同键（后端去重的前提）
  const retry = mod.resolveMembershipUpgradeIdempotency(first, { level: 2 });
  assert.equal(retry.key, first.key);
  // 换等级 → 新键
  const other = mod.resolveMembershipUpgradeIdempotency(first, { level: 3 });
  assert.notEqual(other.key, first.key);

  // 屏幕接线：ref 持键、传入 API、成功后失效
  const screen = read('src/features/profile/screens/MemberCenterScreen.tsx');
  assert.match(screen, /resolveMembershipUpgradeIdempotency\(/);
  assert.match(screen, /upgradeMembership\(level, idempotency\.key\)/);
  assert.match(screen, /upgradeIdempotencyRef\.current = null;/);
});

test('转账卡片发出后向后端回执，key 贯穿 pending store (#100)', () => {
  const store = read('src/features/chat/store/use-transfer-composer-store.ts');
  assert.match(store, /idempotencyKey: string \| null/);

  const composer = read('src/features/chat/screens/TransferComposerScreen.tsx');
  assert.match(composer, /idempotencyKey: idempotency\.key/);

  const chat = read('src/features/chat/screens/ChatDetailScreen.tsx');
  // round 2：回执改为持久化挂账（enqueue → flush），不再 fire-and-forget
  assert.match(chat, /enqueueGiftCardAck\(payload\.idempotencyKey\)/);
  assert.match(chat, /flushPendingGiftCardAcks\(\)/);

  const api = read('src/services/api/coin.ts');
  assert.match(api, /\/coin\/gift\/card-sent/);
});

test('卡片回执持久挂账：失败保留、成功销账、app 重启不丢 (round 2)', async () => {
  const stored = new Map();
  let markCalls = 0;
  let markShouldFail = true;
  const mod = loadTsModule('src/features/chat/utils/gift-card-ack.ts', {
    requireShim: (specifier) => {
      if (specifier === 'react-native') {
        return { AppState: { addEventListener: () => ({ remove: () => {} }) } };
      }
      if (specifier === '@/stores/authStore') {
        return {
          useAuthStore: { getState: () => ({ user: { id: 'user-1' } }) },
        };
      }
      if (specifier === '@/storage') {
        return {
          storage: {
            getString: (key) => stored.get(key),
            set: (key, value) => stored.set(key, value),
          },
        };
      }
      if (specifier === '@/services/api/coin') {
        return {
          markGiftCardSent: async () => {
            markCalls += 1;
            if (markShouldFail) throw new Error('timeout');
          },
        };
      }
      throw new Error(`unexpected import in gift-card-ack: ${specifier}`);
    },
    context: { setTimeout, clearTimeout, console },
  });

  // 发卡成功 → 入账；回执失败 → 挂账保留（持久化在 storage 里）
  mod.enqueueGiftCardAck('key-1');
  await mod.flushPendingGiftCardAcks();
  assert.equal(markCalls, 1);
  assert.match(String(stored.get('circle-im-gift-card-pending-acks')), /key-1/);

  // 网络恢复后再 flush → 销账
  markShouldFail = false;
  await mod.flushPendingGiftCardAcks();
  assert.equal(markCalls, 2);
  assert.doesNotMatch(
    String(stored.get('circle-im-gift-card-pending-acks')),
    /key-1/,
  );
  // round 3：挂账按用户隔离持久化（{key, userId}），换号不误冲
  mod.enqueueGiftCardAck('key-2');
  assert.match(
    String(stored.get('circle-im-gift-card-pending-acks')),
    /"userId":"user-1"/,
  );
  // round 3：失败自动安排延时重试 + 回前台补冲（源码断言）
  const src = read('src/features/chat/utils/gift-card-ack.ts');
  assert.match(src, /scheduleRetry\(\)/);
  assert.match(src, /AppState\.addEventListener/);
  assert.match(src, /item\.userId === userId/);
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
