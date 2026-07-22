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
  assert.match(chat, /markGiftCardSent\(payload\.idempotencyKey\)/);

  const api = read('src/services/api/coin.ts');
  assert.match(api, /\/coin\/gift\/card-sent/);
});

// ---------------------------------------------------------------------------
// #89 / #116
// ---------------------------------------------------------------------------

test('朋友圈轮询已有前台门控，后台不空转 (#89 现状钉死)', () => {
  const feed = read('src/features/discover/components/moments-feed.tsx');
  assert.match(feed, /AppState\.currentState === 'active'/);
  assert.match(feed, /stopInterval\(\)/);
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
