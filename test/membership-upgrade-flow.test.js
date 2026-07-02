const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function loadFlow({ getApiErrorMessage = () => 'localized failure' } = {}) {
  const filePath = path.join(
    process.cwd(),
    'src/features/profile/membership-upgrade-flow.ts',
  );
  const transpiled = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;
  const moduleObj = { exports: {} };
  const shimRequire = (spec) => {
    if (spec === '@/services/api/errors') return { getApiErrorMessage };
    return require(spec);
  };
  const fn = new Function('module', 'exports', 'require', transpiled);
  fn(moduleObj, moduleObj.exports, shimRequire);
  return moduleObj.exports;
}

const currentUser = {
  id: 'user-1',
  accountId: 'alice',
  uid: 'alice',
  nickname: 'Alice',
  avatarUrl: null,
  avatarFrame: null,
  cover: null,
  email: null,
  phoneNumber: null,
  wechat: null,
  qq: null,
  whatsup: null,
  persona: null,
  helloWords: null,
  birthday: null,
  gender: 'unset',
  role: 'USER',
  status: 'ACTIVE',
  lastOnline: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  city: null,
  vipLevel: 1,
  creditScore: 100,
  fancyNumber: false,
  displayIcons: [],
};

test('membership upgrade keeps success state when post-upgrade user refresh fails', async () => {
  const { performMembershipUpgradeFlow } = loadFlow({
    getApiErrorMessage: () => {
      throw new Error('upgrade failure formatter should not run after upgrade success');
    },
  });
  const users = [];
  const statuses = [];

  await performMembershipUpgradeFlow({
    selectedLevel: 3,
    upgradeMembership: async () => ({
      user: { id: 'user-1', vipLevel: 3, creditScore: 125 },
      wallet: {},
      plan: {},
    }),
    fetchCurrentUser: async () => {
      throw new Error('refresh failed');
    },
    getCurrentUser: () => currentUser,
    setUser: (user) => users.push(user),
    setStatusText: (text) => statuses.push(text),
    t: (key, opts) =>
      key === 'profile.membership.exchangeSuccess'
        ? `upgraded VIP${opts.level}`
        : opts.defaultValue,
  });

  assert.equal(users.length, 1);
  assert.equal(users[0].vipLevel, 3);
  assert.equal(users[0].creditScore, 125);
  assert.deepEqual(statuses, ['upgraded VIP3']);
});

test('membership upgrade formats the original upgrade failure', async () => {
  const expectedError = new Error('not enough points');
  const calls = [];
  const { performMembershipUpgradeFlow } = loadFlow({
    getApiErrorMessage: (err, fallback) => {
      calls.push([err, fallback]);
      return 'localized not enough points';
    },
  });
  const statuses = [];

  await performMembershipUpgradeFlow({
    selectedLevel: 4,
    upgradeMembership: async () => {
      throw expectedError;
    },
    fetchCurrentUser: async () => {
      throw new Error('must not refresh after failed upgrade');
    },
    getCurrentUser: () => currentUser,
    setUser: () => {
      throw new Error('must not update user after failed upgrade');
    },
    setStatusText: (text) => statuses.push(text),
    t: (key, opts) =>
      key === 'profile.membership.exchangeError'
        ? 'exchange fallback'
        : opts.defaultValue,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], expectedError);
  assert.equal(calls[0][1], 'exchange fallback');
  assert.deepEqual(statuses, ['localized not enough points']);
});
