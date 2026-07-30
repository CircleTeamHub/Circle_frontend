const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadTsModule(relativePath, stubs = {}) {
  const filePath = path.join(process.cwd(), relativePath);
  const source = fs.readFileSync(filePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      baseUrl: process.cwd(),
      paths: {
        '@/*': ['src/*'],
      },
    },
    fileName: filePath,
  }).outputText;

  const context = {
    module: { exports: {} },
    exports: {},
    require: (specifier) => {
      if (specifier in stubs) {
        return stubs[specifier];
      }

      return require(specifier);
    },
  };
  context.exports = context.module.exports;

  vm.runInNewContext(transpiled, context, { filename: filePath });

  return context.module.exports;
}

test('contact friend helpers group and sort friends by normalized display key', () => {
  const {
    buildContactSections,
    buildRecentFriends,
    getFriendDisplayName,
  } = loadTsModule('src/features/contacts/contact-friends.ts');

  const friends = [
    {
      id: 'friend-1',
      accountId: 'alice_001',
      nickname: 'Alice',
      avatarUrl: null,
      avatarFrame: null,
      gender: 'female',
      lastOnline: null,
      friendsSince: '2026-04-07T08:00:00.000Z',
    },
    {
      id: 'friend-2',
      accountId: 'zhangsan',
      nickname: '张三',
      avatarUrl: null,
      avatarFrame: null,
      gender: 'male',
      lastOnline: null,
      friendsSince: '2026-04-08T08:00:00.000Z',
    },
    {
      id: 'friend-3',
      accountId: '2cool',
      nickname: '007',
      avatarUrl: null,
      avatarFrame: null,
      gender: 'unset',
      lastOnline: null,
      friendsSince: '2026-04-06T08:00:00.000Z',
    },
    {
      id: 'friend-4',
      accountId: 'bravo',
      nickname: ' ',
      avatarUrl: null,
      avatarFrame: null,
      gender: 'unset',
      lastOnline: null,
      friendsSince: '2026-04-05T08:00:00.000Z',
    },
  ];

  assert.equal(getFriendDisplayName(friends[0]), 'Alice');
  assert.equal(getFriendDisplayName(friends[3]), 'bravo');

  assert.deepEqual(
    Array.from(buildRecentFriends(friends), (friend) => friend.id),
    ['friend-2', 'friend-1', 'friend-3', 'friend-4'],
  );

  const sections = Array.from(buildContactSections(friends));

  assert.deepEqual(
    sections.map((section) => section.title),
    ['A', 'B', 'Z', '#'],
  );
  assert.deepEqual(
    sections.map((section) => Array.from(section.data, (friend) => friend.id)),
    [['friend-1'], ['friend-4'], ['friend-2'], ['friend-3']],
  );
});

test('pickExactAccountMatch prefers case-insensitive exact account matches over partial matches', () => {
  const { pickExactAccountMatch } = loadTsModule('src/services/api/users.ts', {
    '@/services/api/client': { apiClient: async () => [] },
    '@/services/api/utils': {
      normalizeAvatarFrameAppearance: (value) => value ?? null,
      normalizeUserAvatarFrameAppearance: (value) => value ?? null,
      normalizeUser: (value) => value,
    },
  });

  const match = pickExactAccountMatch('AB100C', [
    { id: 'user-1', accountId: 'AB1000' },
    { id: 'user-2', accountId: 'ab100c' },
    { id: 'user-3', accountId: 'something-else' },
  ]);

  assert.equal(match.id, 'user-2');
  assert.equal(pickExactAccountMatch('missing', [{ accountId: 'miss' }]), null);
});

test('searchUsersByAccountId calls the dedicated account search endpoint', async () => {
  const calls = [];
  const { searchUsersByAccountId } = loadTsModule('src/services/api/users.ts', {
    '@/services/api/client': {
      apiClient: async (endpoint) => {
        calls.push(endpoint);
        return {
          id: 'user-1',
          accountId: 'jimmy',
          nickname: 'Jimmy',
          avatarUrl: null,
        };
      },
    },
    '@/services/api/utils': {
      normalizeAvatarFrameAppearance: (value) => value ?? null,
      normalizeUserAvatarFrameAppearance: (value) => value ?? null,
      normalizeMediaUrl: (value) => value,
    },
  });

  const user = await searchUsersByAccountId('jimmy');

  assert.equal(calls[0], '/user/search/account?accountId=jimmy');
  assert.equal(user.accountId, 'jimmy');
});

test('fetchFriends drops malformed rows before contacts render them', async () => {
  const { fetchFriends } = loadTsModule('src/services/api/friends.ts', {
    '@/services/api/client': {
      apiClient: async () => [
        null,
        { id: '', accountId: 'missing-id' },
        { id: 'missing-account', accountId: '' },
        {
          id: 'friend-1',
          accountId: 'alice_001',
          nickname: null,
          avatarUrl: 42,
          avatarFrame: undefined,
          gender: undefined,
          lastOnline: undefined,
          friendsSince: undefined,
        },
      ],
    },
    '@/services/api/utils': {
      fetchCountEndpoint: async () => 0,
      normalizeAvatarFrameAppearance: (value) => value ?? null,
      normalizeMediaUrl: (value) => value,
    },
  });

  const friends = await fetchFriends();

  assert.deepEqual(
    JSON.parse(JSON.stringify(friends)),
    [
      {
        id: 'friend-1',
        accountId: 'alice_001',
        nickname: 'alice_001',
        avatarUrl: null,
        avatarFrame: null,
        avatarFrameAppearance: null,
        gender: '',
        lastOnline: null,
        friendsSince: '',
        remark: null,
      },
    ],
  );
});

test('fetchFriends deduplicates repeated friend ids before SectionList sees them', async () => {
  const { fetchFriends } = loadTsModule('src/services/api/friends.ts', {
    '@/services/api/client': {
      apiClient: async () => [
        {
          id: 'friend-1',
          accountId: 'alice_001',
          nickname: 'Alice',
          avatarUrl: null,
          avatarFrame: null,
          gender: 'unset',
          lastOnline: null,
          friendsSince: '2026-07-24T07:59:51.066Z',
          remark: 'new remark',
        },
        {
          id: 'friend-1',
          accountId: 'alice_001',
          nickname: 'Alice old',
          avatarUrl: null,
          avatarFrame: null,
          gender: 'unset',
          lastOnline: null,
          friendsSince: '2026-06-26T08:06:52.906Z',
          remark: 'old remark',
        },
      ],
    },
    '@/services/api/utils': {
      fetchCountEndpoint: async () => 0,
      normalizeAvatarFrameAppearance: (value) => value ?? null,
      normalizeMediaUrl: (value) => value,
    },
  });

  const friends = await fetchFriends();

  assert.deepEqual(
    JSON.parse(JSON.stringify(friends)),
    [
      {
        id: 'friend-1',
        accountId: 'alice_001',
        nickname: 'Alice',
        avatarUrl: null,
        avatarFrame: null,
        avatarFrameAppearance: null,
        gender: 'unset',
        lastOnline: null,
        friendsSince: '2026-07-24T07:59:51.066Z',
        remark: 'new remark',
      },
    ],
  );
});
