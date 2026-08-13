const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

const LOCALES = ['zh', 'en', 'ja', 'ko', 'es'];

function loadReferralApi(apiClient) {
  const filePath = path.join(process.cwd(), 'src/services/api/referrals.ts');
  const output = ts.transpileModule(read('src/services/api/referrals.ts'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;
  const context = {
    module: { exports: {} },
    exports: {},
    require: (specifier) => {
      if (specifier === '@/services/api/client') return { apiClient };
      if (specifier === '@/i18n') {
        return {
          __esModule: true,
          default: { t: (_key, options) => options?.defaultValue ?? _key },
        };
      }
      if (specifier === '@/utils/validate') {
        return {
          expectShape: (value, predicate, message) => {
            if (!predicate(value)) throw new Error(message);
            return value;
          },
          isNonEmptyString: (value) =>
            typeof value === 'string' && value.length > 0,
          isPlainObject: (value) =>
            value !== null && typeof value === 'object' && !Array.isArray(value),
        };
      }
      throw new Error(`Unexpected import: ${specifier}`);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(output, context, { filename: filePath });
  return context.module.exports;
}

const response = {
  inviteCode: 'abc123',
  rules: {
    enabled: true,
    inviterReward: 20,
    inviteeReward: 5,
    qualificationDays: 7,
    expiryDays: 30,
    monthlyCap: 10,
  },
  summary: {
    total: 1,
    pending: 0,
    rewarded: 1,
    capped: 0,
    rejected: 0,
    expired: 0,
    pointsEarned: 20,
  },
  items: [
    {
      id: 'referral-1',
      status: 'REWARDED',
      inviterReward: 20,
      inviteeReward: 5,
      eligibleAt: '2026-08-19T00:00:00.000Z',
      expiresAt: '2026-09-11T00:00:00.000Z',
      qualifiedAt: '2026-08-19T00:00:00.000Z',
      rewardedAt: '2026-08-19T00:00:00.000Z',
      failureReason: null,
      createdAt: '2026-08-12T00:00:00.000Z',
      invitee: { id: 'invitee-1', nickname: 'New Friend' },
    },
  ],
  nextCursor: null,
};

test('referral API loads the authenticated invite summary and validates money fields', async () => {
  const calls = [];
  const api = loadReferralApi(async (endpoint) => {
    calls.push(endpoint);
    return response;
  });

  const result = await api.fetchMyReferrals();

  assert.deepEqual(calls, ['/referrals/me']);
  assert.equal(result.summary.pointsEarned, 20);
  assert.equal(result.items[0].status, 'REWARDED');
});

test('referral API encodes pagination parameters', async () => {
  const calls = [];
  const api = loadReferralApi(async (endpoint) => {
    calls.push(endpoint);
    return response;
  });

  await api.fetchMyReferrals({ cursor: 'cursor/with space', limit: 10 });

  assert.deepEqual(calls, [
    '/referrals/me?cursor=cursor%2Fwith%20space&limit=10',
  ]);
});

test('referral API rejects inconsistent summary totals and malformed rewards', async () => {
  const invalidTotal = loadReferralApi(async () => ({
    ...response,
    summary: { ...response.summary, total: 2 },
  }));
  await assert.rejects(invalidTotal.fetchMyReferrals(), /邀请数据格式异常/);

  const invalidReward = loadReferralApi(async () => ({
    ...response,
    items: [{ ...response.items[0], inviterReward: -20 }],
  }));
  await assert.rejects(invalidReward.fetchMyReferrals(), /邀请数据格式异常/);
});

test('invite deep link prefills registration and authenticated users return to invite center', () => {
  const staticRoute = read('app/invite.tsx');
  const route = read('app/invite/[code].tsx');
  const screen = read('src/features/auth/screens/InviteLinkScreen.tsx');
  const register = read('src/features/auth/screens/RegisterScreen.tsx');

  assert.match(staticRoute, /InviteLinkScreen/);
  assert.match(route, /InviteLinkScreen/);
  assert.match(screen, /\(tabs\)\/profile\/share/);
  assert.match(screen, /pathname: '\/\(auth\)\/register'/);
  assert.match(screen, /params: inviteCode \? \{ inviteCode \} : \{\}/);
  assert.match(register, /useLocalSearchParams/);
  assert.match(register, /inviteCodeParam\.trim\(\)\.toLowerCase\(\)/);
});

test('invite center shows rules, progress, records, copy, and share actions', () => {
  const screen = read('src/features/profile/screens/ShareScreen.tsx');

  assert.match(screen, /fetchMyReferrals/);
  assert.match(screen, /summary\.pointsEarned/);
  assert.match(screen, /rules\.qualificationDays/);
  assert.match(screen, /items\.map\(renderReferral\)/);
  assert.match(screen, /handleCopyInviteCode/);
  assert.match(screen, /handleShareInvite/);
  assert.match(screen, /EXPO_PUBLIC_INVITE_BASE_URL/);
  assert.match(screen, /Linking\.createURL\('\/invite'/);
});

test('wallet renders referral ledger types and realtime wallet pokes refetch authority', () => {
  const wallet = read('src/features/profile/screens/WalletScreen.tsx');
  const realtime = read('src/realtime/client.ts');

  assert.match(wallet, /fetchCoinTransactions/);
  assert.match(wallet, /REFERRAL_REWARD/);
  assert.match(wallet, /REFERRAL_BONUS/);
  assert.match(realtime, /refreshWalletBalanceBestEffort/);
  assert.match(realtime, /fetchWallet\(\)/);
  assert.match(realtime, /walletRefreshPromise/);
});

// 余额与流水绑在同一个 allSettled 上时,慢一拍的流水请求会把已经拿到的余额压在
// 「...」上,最坏等满 15s 的接口超时 —— 而余额是这个页面的主信息。
test('wallet balance renders without waiting for transaction history', () => {
  const wallet = read('src/features/profile/screens/WalletScreen.tsx');

  // 注释里提到这个名字不算数,盯的是真正的调用形状。
  assert.doesNotMatch(wallet, /await Promise\.allSettled\(\[/);
  assert.match(wallet, /async function loadBalance\(\)/);
  assert.match(wallet, /async function loadHistory\(\)/);
  assert.match(wallet, /const \[loadingHistory, setLoadingHistory\]/);
  // 余额的等待态只受余额请求影响,空列表文案只受流水请求影响。
  assert.match(wallet, /\{loadingWallet \? '\.\.\.' : balance\}/);
  assert.match(wallet, /transactions\.length === 0 && !loadingHistory/);
});

// 翻页请求是按旧游标取的:期间发生过刷新,拼上去就会重复/漏行,
// 还会把第一页的规则与汇总换成翻页响应里的。
test('referral pagination is fenced against a concurrent refresh', () => {
  const screen = read('src/features/profile/screens/ShareScreen.tsx');

  assert.match(screen, /const requestGeneration = useRef\(0\)/);
  assert.match(
    screen,
    /const generation = requestGeneration\.current \+ 1;\s*\n\s*requestGeneration\.current = generation;/,
  );
  assert.match(
    screen,
    /const generation = requestGeneration\.current;\s*\n\s*setLoadingMore\(true\)/,
  );
  assert.match(screen, /if \(generation !== requestGeneration\.current\) return;/);
  // 只往后接记录并推进游标,不拿翻页响应整个替换
  assert.match(
    screen,
    /\.\.\.current,\s*\n\s*items: \[\.\.\.current\.items, \.\.\.next\.items\],\s*\n\s*nextCursor: next\.nextCursor,/,
  );
});

// 首次加载成功之后,下拉刷新失败时渲染永远走 data 分支 —— 不单独提示的话这次
// 失败完全看不见,用户会把过期的达标状态与积分当成当前的。
test('a failed refresh over stale referral data is visible', () => {
  const screen = read('src/features/profile/screens/ShareScreen.tsx');

  assert.match(screen, /\{error && data \?/);
  assert.match(screen, /referral\.errors\.staleData/);
  // 成功之后才清 error,失败时保留旧数据。
  assert.match(screen, /setData\(next\);\s*\n\s*setError\(null\);/);
});

// 规则没拿到之前报 20/5 是写死的默认值:部署改过额度、或活动暂停时,加载中与
// 加载失败都会给用户看错的激励条件,失败时还是永久错的。
test('referral hero does not advertise reward numbers before rules load', () => {
  const screen = read('src/features/profile/screens/ShareScreen.tsx');

  assert.doesNotMatch(screen, /inviterReward \?\? 20/);
  assert.doesNotMatch(screen, /inviteeReward \?\? 5/);
  assert.match(screen, /!data\s*\n?\s*\? t\('referral\.heroSubtitlePending'\)/);
  assert.match(screen, /inviter: data\.rules\.inviterReward/);
});

test('两条新文案五种语言齐备', () => {
  for (const locale of LOCALES) {
    const dict = JSON.parse(read(`src/i18n/locales/${locale}.json`));
    assert.ok(
      dict.referral?.heroSubtitlePending,
      `${locale} 缺 referral.heroSubtitlePending`,
    );
    assert.ok(
      dict.referral?.errors?.staleData,
      `${locale} 缺 referral.errors.staleData`,
    );
  }
});
