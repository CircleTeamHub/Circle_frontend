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
          normalizeAvatarFrameAppearance: (value) => value ?? null,
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
          expiresAt: null,
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
          expiresAt: '2026-06-06T00:00:00.000Z',
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
      expiresAt: '',
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
      expiresAt: '2026-06-06T00:00:00.000Z',
    },
  ]);
});

test('fetchPlazaFeed keeps author display badges and normalizes badge media URLs', async () => {
  const { api, calls } = loadPlazaApi([
    {
      items: [
        {
          id: 'post-1',
          content: 'hello',
          images: ['http://localhost:9000/posts/a.jpg'],
          tags: [],
          city: '深圳',
          isHorn: false,
          noteId: null,
          restrictions: { vipLevel: null, creditScore: null, fancyNumber: false },
          viewCount: 0,
          signupCount: 1,
          signedByMe: false,
          signupRestrictions: { vipLevel: null, creditScore: null, fancyNumber: false },
          canSignup: true,
          author: {
            id: 'u1',
            nickname: 'Author',
            avatarUrl: 'http://localhost:9000/avatars/u1.jpg',
            avatarFrame: null,
            accountId: '1001',
            displayIcons: [
              {
                id: 'vip-5',
                type: 'SYSTEM',
                title: 'VIP5',
                imageUrl: null,
                fallbackIconName: null,
                systemKey: 'VIP',
                systemVariant: 'VIP5',
                sortOrder: 0,
              },
              {
                id: 'circle-1',
                type: 'CIRCLE',
                title: '圈子建设者',
                imageUrl: 'http://localhost:9000/icons/circle.png',
                fallbackIconName: null,
                circleId: 'c1',
                circleName: '圈子建设者',
                sortOrder: 1,
              },
            ],
          },
          circle: { id: 'c1', name: 'circle' },
          canInteract: true,
          createdAt: '2026-06-29T00:00:00.000Z',
          expiresAt: '2026-07-02T00:00:00.000Z',
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
      hasMore: false,
    },
  ]);

  const result = await api.fetchPlazaFeed({ city: '深圳' });

  assert.equal(calls[0][0], '/circle-plaza/feed?city=%E6%B7%B1%E5%9C%B3');
  assert.deepEqual(JSON.parse(JSON.stringify(result.items[0].author.displayIcons)), [
    {
      id: 'vip-5',
      type: 'SYSTEM',
      title: 'VIP5',
      imageUrl: null,
      fallbackIconName: null,
      systemKey: 'VIP',
      systemVariant: 'VIP5',
      sortOrder: 0,
    },
    {
      id: 'circle-1',
      type: 'CIRCLE',
      title: '圈子建设者',
      imageUrl: 'http://192.168.1.65:9000/icons/circle.png',
      fallbackIconName: null,
      circleId: 'c1',
      circleName: '圈子建设者',
      sortOrder: 1,
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

  assert.deepEqual(JSON.parse(JSON.stringify(signups)), {
    items: [
      {
        userId: 'user-1',
        imUserId: '',
        nickname: '用户',
        avatarUrl: 'http://192.168.1.65:9000/avatars/u.jpg',
        accountId: '',
        signedAt: '',
        seen: false,
        displayIcons: [],
        recognized: false,
      },
    ],
    // 后端缺省 recognitionOpen → 安全默认为 false（不放出认可入口）。
    recognitionOpen: false,
  });
});

test('fetchMyPostSignups carries recognized flags and recognitionOpen from backend', async () => {
  const { api } = loadPlazaApi([
    {
      recognitionOpen: true,
      items: [
        {
          userId: 'user-1',
          imUserId: 'im-1',
          nickname: 'Ann',
          avatarUrl: null,
          accountId: 'a1',
          signedAt: '2026-06-01T00:00:00Z',
          seen: true,
          recognized: true,
        },
      ],
    },
  ]);

  const result = await api.fetchMyPostSignups('post-1');

  assert.equal(result.recognitionOpen, true);
  assert.equal(result.items[0].recognized, true);
});

test('fetchMyPostSignups keeps signer display badges and normalizes badge media URLs', async () => {
  const { api } = loadPlazaApi([
    {
      items: [
        {
          userId: 'user-1',
          imUserId: 'im-1',
          nickname: 'Ann',
          avatarUrl: null,
          accountId: 'a1',
          signedAt: '2026-06-01T00:00:00Z',
          seen: true,
          recognized: false,
          displayIcons: [
            {
              id: 'vip-5',
              type: 'SYSTEM',
              title: 'VIP5',
              imageUrl: null,
              fallbackIconName: null,
              systemKey: 'VIP',
              systemVariant: 'VIP5',
              sortOrder: 0,
            },
            {
              id: 'circle-1',
              type: 'CIRCLE',
              title: '圈子建设者',
              imageUrl: 'http://localhost:9000/icons/circle.png',
              fallbackIconName: null,
              circleId: 'c1',
              circleName: '圈子建设者',
              sortOrder: 1,
            },
          ],
        },
      ],
    },
  ]);

  const result = await api.fetchMyPostSignups('post-1');

  assert.deepEqual(JSON.parse(JSON.stringify(result.items[0].displayIcons)), [
    {
      id: 'vip-5',
      type: 'SYSTEM',
      title: 'VIP5',
      imageUrl: null,
      fallbackIconName: null,
      systemKey: 'VIP',
      systemVariant: 'VIP5',
      sortOrder: 0,
    },
    {
      id: 'circle-1',
      type: 'CIRCLE',
      title: '圈子建设者',
      imageUrl: 'http://192.168.1.65:9000/icons/circle.png',
      fallbackIconName: null,
      circleId: 'c1',
      circleName: '圈子建设者',
      sortOrder: 1,
    },
  ]);
});

test('submitPostCollaborationRecognitions posts selected signer ids', async () => {
  const { api, calls } = loadPlazaApi([
    { count: 2, recognizedUserIds: ['user-1', 'user-2'] },
  ]);

  const result = await api.submitPostCollaborationRecognitions('post-1', [
    'user-1',
    'user-2',
  ]);

  assert.equal(
    calls[0][0],
    '/circle-plaza/me/posts/post-1/collaboration-recognitions',
  );
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][1])), {
    method: 'POST',
    body: { recipientIds: ['user-1', 'user-2'] },
  });
  assert.deepEqual(result, {
    count: 2,
    recognizedUserIds: ['user-1', 'user-2'],
  });
});

test('createPlazaPost forwards the selected expiry duration', async () => {
  const { api, calls } = loadPlazaApi([
    {
      id: 'post-1',
      content: 'hello',
      images: [],
      tags: [],
      city: null,
      isHorn: false,
      noteId: null,
      restrictions: { vipLevel: null, creditScore: null, fancyNumber: false },
      viewCount: 0,
      signupCount: 0,
      signedByMe: false,
      signupRestrictions: { vipLevel: null, creditScore: null, fancyNumber: false },
      canSignup: true,
      author: {
        id: 'u1',
        nickname: 'me',
        avatarUrl: null,
        avatarFrame: null,
        accountId: '1001',
      },
      circle: { id: 'c1', name: 'circle' },
      canInteract: true,
      createdAt: '2026-06-29T00:00:00.000Z',
      expiresAt: '2026-07-02T00:00:00.000Z',
    },
  ]);

  await api.createPlazaPost({
    content: 'hello',
    images: [],
    tags: [],
    circleId: 'c1',
    city: null,
    noteId: null,
    isHorn: false,
    expiresInHours: 72,
    vipRestriction: null,
    creditRestriction: null,
    fancyRestriction: false,
    signupVipRestriction: null,
    signupCreditRestriction: null,
    signupFancyRestriction: false,
  });

  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), [
    '/circle-plaza/posts',
    {
      method: 'POST',
      body: {
        content: 'hello',
        images: [],
        tags: [],
        circleId: 'c1',
        city: null,
        noteId: null,
        isHorn: false,
        expiresInHours: 72,
        vipRestriction: null,
        creditRestriction: null,
        fancyRestriction: false,
        signupVipRestriction: null,
        signupCreditRestriction: null,
        signupFancyRestriction: false,
      },
    },
  ]);
});
