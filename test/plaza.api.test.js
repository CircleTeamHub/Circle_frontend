const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadPlazaApi(apiResponses) {
  const filePath = path.join(process.cwd(), 'src/services/api/plaza.ts');
  const source = fs.readFileSync(filePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      baseUrl: process.cwd(),
      paths: { '@/*': ['src/*'] },
    },
    fileName: filePath,
  }).outputText;

  const calls = [];
  const responses = [...apiResponses];
  const context = {
    module: { exports: {} },
    exports: {},
    URL,
    require: (specifier) => {
      if (specifier === '@/services/api/client') {
        return {
          apiClient: async (...args) => {
            calls.push(args);
            if (responses.length === 0) {
              throw new Error('No mocked response left');
            }
            return responses.shift();
          },
        };
      }
      if (specifier === '@/services/api/utils') {
        return {
          buildQuery: (params) => {
            const q = new URLSearchParams();
            for (const [key, value] of Object.entries(params)) {
              if (value !== undefined && value !== null && value !== '') {
                q.set(key, String(value));
              }
            }
            const qs = q.toString();
            return qs ? `?${qs}` : '';
          },
          normalizeMediaUrl: (value) =>
            value ? value.replace('http://localhost', 'http://192.168.1.65') : value ?? null,
        };
      }
      return require(specifier);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return { api: context.module.exports, calls };
}

test('fetchAllMyCirclePosts loads every page and normalizes each row defensively', async () => {
  const { api, calls } = loadPlazaApi([
    {
      items: [
        {
          id: 'post-1',
          circleId: 'circle-1',
          excerpt: null,
          firstImage: 'http://localhost:9000/circle/a.jpg',
          signupCount: null,
          unreadSignupCount: undefined,
          status: null,
          createdAt: null,
        },
      ],
      total: 2,
      page: 1,
      limit: 1,
      hasMore: true,
    },
    {
      items: [
        {
          id: 'post-2',
          circleId: 'circle-2',
          excerpt: 'hello',
          firstImage: null,
          signupCount: 3,
          unreadSignupCount: 1,
          status: 'ACTIVE',
          createdAt: '2026-06-05T00:00:00.000Z',
        },
      ],
      total: 2,
      page: 2,
      limit: 1,
      hasMore: false,
    },
  ]);

  const posts = await api.fetchAllMyCirclePosts();

  assert.deepEqual(calls.map((call) => call[0]), [
    '/circle-plaza/me/posts?page=1',
    '/circle-plaza/me/posts?page=2',
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(posts)), [
    {
      id: 'post-1',
      circleId: 'circle-1',
      excerpt: '',
      firstImage: 'http://192.168.1.65:9000/circle/a.jpg',
      signupCount: 0,
      unreadSignupCount: 0,
      status: 'UNKNOWN',
      createdAt: '',
    },
    {
      id: 'post-2',
      circleId: 'circle-2',
      excerpt: 'hello',
      firstImage: null,
      signupCount: 3,
      unreadSignupCount: 1,
      status: 'ACTIVE',
      createdAt: '2026-06-05T00:00:00.000Z',
    },
  ]);
});

test('fetchMyPostSignups normalizes missing signer fields with safe defaults', async () => {
  const { api } = loadPlazaApi([
    {
      items: [
        {
          userId: 'user-1',
          imUserId: null,
          nickname: null,
          avatarUrl: 'http://localhost:9000/avatars/u.jpg',
          accountId: undefined,
          signedAt: null,
          seen: null,
        },
      ],
    },
  ]);

  const signups = await api.fetchMyPostSignups('post-1');

  assert.deepEqual(JSON.parse(JSON.stringify(signups)), [
    {
      userId: 'user-1',
      imUserId: '',
      nickname: '用户',
      avatarUrl: 'http://192.168.1.65:9000/avatars/u.jpg',
      accountId: '',
      signedAt: '',
      seen: false,
    },
  ]);
});
