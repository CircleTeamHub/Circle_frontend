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

test('createFriendRequest omits blank optional fields from the request body', async () => {
  const calls = [];
  const { createFriendRequest } = loadTsModule('src/services/api/friends.ts', {
    '@/services/api/client': {
      apiClient: async (endpoint, options) => {
        calls.push({ endpoint, options });
      },
    },
    '@/services/api/utils': { normalizeMediaUrl: (value) => value },
  });

  await createFriendRequest({
    targetId: 'target-id',
    message: '   ',
    remark: '',
    tagIds: [],
  });

  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    {
      endpoint: '/friend/requests',
      options: {
        method: 'POST',
        body: {
          targetId: 'target-id',
        },
      },
    },
  ]);
});

test('createFriendRequest forwards non-empty message, remark, and tagIds in the request body', async () => {
  const calls = [];
  const { createFriendRequest } = loadTsModule('src/services/api/friends.ts', {
    '@/services/api/client': {
      apiClient: async (endpoint, options) => {
        calls.push({ endpoint, options });
      },
    },
    '@/services/api/utils': { normalizeMediaUrl: (value) => value },
  });

  await createFriendRequest({
    targetId: 'target-id',
    message: '你好，我是小李',
    remark: '产品同学',
    tagIds: ['tag-1', 'tag-2'],
  });

  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    {
      endpoint: '/friend/requests',
      options: {
        method: 'POST',
        body: {
          targetId: 'target-id',
          message: '你好，我是小李',
          remark: '产品同学',
          tagIds: ['tag-1', 'tag-2'],
        },
      },
    },
  ]);
});

test('createFriendRequest still supports the positional message overload', async () => {
  const calls = [];
  const { createFriendRequest } = loadTsModule('src/services/api/friends.ts', {
    '@/services/api/client': {
      apiClient: async (endpoint, options) => {
        calls.push({ endpoint, options });
      },
    },
    '@/services/api/utils': { normalizeMediaUrl: (value) => value },
  });

  await createFriendRequest('target-id', '你好，我是小李');

  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    {
      endpoint: '/friend/requests',
      options: {
        method: 'POST',
        body: {
          targetId: 'target-id',
          message: '你好，我是小李',
        },
      },
    },
  ]);
});

test('buildSendFriendRequestInitialMessage falls back to accountId when nickname is absent', () => {
  const { buildSendFriendRequestInitialMessage } = loadTsModule(
    'src/features/social/send-friend-request.ts',
    {
      '@/i18n': {
        default: {
          t: (key, params) =>
            key === 'contacts.request.defaultMessage'
              ? `你好，我是 ${params.name}`
              : key,
        },
      },
    },
  );

  assert.equal(
    buildSendFriendRequestInitialMessage({ nickname: '', accountId: 'meigui' }),
    '你好，我是 meigui',
  );
});

test('send friend request screen is wired to i18n-driven form copy', () => {
  const filePath = path.join(
    process.cwd(),
    'src/features/social/screens/SendFriendRequestScreen.tsx',
  );
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /useTranslation\(/);
  assert.match(source, /contacts\.request\./);
  assert.match(source, /placeholder only/i);
  assert.match(source, /buildSendFriendRequestInitialMessage/);
  assert.match(source, /useAuthStore/);
  assert.match(source, /fetchFriendTags/);
  assert.match(source, /selectedTagIds/);
  assert.match(source, /isSubmitting/);
  assert.match(source, /disabled=\{!profileId \|\| isSubmitting\}/);
  assert.doesNotMatch(source, /NavHeader title="发送好友申请"/);
  assert.doesNotMatch(source, /验证消息|备注名|照片备注|朋友权限|发送中\.\.\.|暂无标签/);
});

test('contacts request route exports the dedicated send friend request screen', () => {
  const routeFiles = [
    'app/(tabs)/messages/user/[id]/request.tsx',
    'app/(tabs)/contacts/user/[id]/request.tsx',
    'app/(tabs)/profile/user/[id]/request.tsx',
  ];

  for (const relativePath of routeFiles) {
    const filePath = path.join(process.cwd(), relativePath);
    const source = fs.readFileSync(filePath, 'utf8');

    assert.match(source, /SendFriendRequestScreen/);
    assert.match(source, /export \{ default \} from/);
  }
});
