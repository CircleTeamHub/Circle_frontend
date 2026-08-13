const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

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
