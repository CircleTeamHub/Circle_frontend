const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadApiUtils(options = {}) {
  const filePath = path.join(process.cwd(), 'src/services/api/utils.ts');
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
    URL,
    require: (specifier) => {
      if (specifier === '@/constants/config') {
        return {
          API_URL:
            options.apiUrl ?? 'http://192.168.1.65:3000/api/v1',
          OPENIM_API_URL: 'http://192.168.1.65:10002',
        };
      }

      if (specifier === '@/services/api/client') {
        return {
          apiClient: {},
          ApiError: class ApiError extends Error {},
        };
      }

      return require(specifier);
    },
    __DEV__: options.isDev ?? true,
  };
  context.exports = context.module.exports;

  vm.runInNewContext(transpiled, context, { filename: filePath });

  return context.module.exports;
}

test('normalizeUser keeps backend city field', () => {
  const { normalizeUser } = loadApiUtils();

  const normalized = normalizeUser({
    id: 'user-1',
    accountId: 'account-1',
    inviteCode: 'invite-1',
    username: 'alice',
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
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z',
    city: '杭州',
  });

  assert.equal(normalized.uid, 'account-1');
  assert.equal(normalized.inviteCode, 'invite-1');
  assert.equal(normalized.city, '杭州');
});

test('normalizeUser maps profile like counts from public and self user responses', () => {
  const { normalizeUser } = loadApiUtils();
  const baseUser = {
    id: 'user-1',
    accountId: 'account-1',
    username: 'alice',
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
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z',
    city: '杭州',
  };

  assert.equal(normalizeUser({ ...baseUser, likeCount: 3 }).likeCount, 3);
  assert.equal(
    normalizeUser({ ...baseUser, receivedLikeCount: 4 }).likeCount,
    4,
  );
});

test('normalizeUser preserves a valid avatar frame appearance and normalizes its image URL', () => {
  const { normalizeUser } = loadApiUtils();
  const normalized = normalizeUser({
    id: 'user-1',
    accountId: 'account-1',
    inviteCode: 'invite-1',
    nickname: 'Alice',
    avatarUrl: null,
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
    city: null,
    vipLevel: 3,
    creditScore: 100,
    fancyNumber: false,
    displayIcons: [],
    role: 'USER',
    status: 'ACTIVE',
    lastOnline: null,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z',
    avatarFrameAppearance: {
      id: 'frame-1',
      key: 'membership-diamond',
      name: 'Diamond',
      imageUrl: 'http://localhost:9000/frames/diamond.png',
    },
  });

  assert.equal(normalized.avatarFrame, null, 'missing legacy field becomes null');
  assert.deepEqual(JSON.parse(JSON.stringify(normalized.avatarFrameAppearance)), {
    id: 'frame-1',
    key: 'membership-diamond',
    name: 'Diamond',
    imageUrl: 'http://192.168.1.65:9000/frames/diamond.png',
  });
});

test('embedded avatar frame appearance safely becomes null when absent or malformed', () => {
  const { normalizeAvatarFrameAppearance } = loadApiUtils();

  assert.equal(normalizeAvatarFrameAppearance(undefined), null);
  assert.equal(normalizeAvatarFrameAppearance(null), null);
  assert.equal(
    normalizeAvatarFrameAppearance({
      id: 'frame-1',
      key: 'membership-diamond',
      name: 'Diamond',
      imageUrl: 42,
    }),
    null,
  );
});

test('legacy membership frame fallback applies only when the field is absent', () => {
  const { normalizeUserAvatarFrameAppearance } = loadApiUtils();

  assert.deepEqual(
    JSON.parse(
      JSON.stringify(normalizeUserAvatarFrameAppearance(undefined, 3)),
    ),
    {
      id: 'legacy-membership-diamond',
      key: 'membership-diamond',
      name: 'Diamond membership frame',
      imageUrl: null,
    },
  );
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(normalizeUserAvatarFrameAppearance(undefined, 4)),
    ),
    {
      id: 'legacy-membership-super',
      key: 'membership-super',
      name: 'Super membership frame',
      imageUrl: null,
    },
  );
  assert.equal(normalizeUserAvatarFrameAppearance(null, 4), null);
  assert.equal(normalizeUserAvatarFrameAppearance(undefined, 2), null);
});

test('normalizeMediaUrl rewrites localhost media host without clobbering service port', () => {
  const { normalizeMediaUrl } = loadApiUtils();

  assert.equal(
    normalizeMediaUrl('http://127.0.0.1:10002/object/user/msg.jpg'),
    'http://192.168.1.65:10002/object/user/msg.jpg',
  );
  assert.equal(
    normalizeMediaUrl('http://localhost:9000/circle/chat/file.jpg'),
    'http://192.168.1.65:9000/circle/chat/file.jpg',
  );
});

test('normalizeMediaUrl rewrites stale private media host to the current dev host', () => {
  const { normalizeMediaUrl } = loadApiUtils();

  assert.equal(
    normalizeMediaUrl('http://10.0.0.195:9000/circle/avatars/user.jpg'),
    'http://192.168.1.65:9000/circle/avatars/user.jpg',
  );
  assert.equal(
    normalizeMediaUrl('http://172.16.4.20:10002/object/user/msg.jpg'),
    'http://192.168.1.65:10002/object/user/msg.jpg',
  );
});

test('avatar frame image URLs allow https and reject unsafe schemes, credentials, and public http', () => {
  const { normalizeAvatarFrameImageUrl } = loadApiUtils({
    apiUrl: 'https://api.example.com/api/v1',
    isDev: false,
  });

  assert.equal(
    normalizeAvatarFrameImageUrl('https://cdn.example.com/frame.png'),
    'https://cdn.example.com/frame.png',
  );
  for (const unsafe of [
    'http://cdn.example.com/frame.png',
    'http://localhost:9000/frame.png',
    'https://user:pass@cdn.example.com/frame.png',
    '/relative/frame.png',
    'file:///tmp/frame.png',
    'content://media/frame.png',
    'data:image/png;base64,AAAA',
    'javascript:alert(1)',
    'not a url',
  ]) {
    assert.equal(
      normalizeAvatarFrameImageUrl(unsafe),
      null,
      `${unsafe} must be rejected`,
    );
  }
});

test('avatar frame image URLs allow configured private http media origins only in dev', () => {
  const dev = loadApiUtils({
    apiUrl: 'http://192.168.1.65:3000/api/v1',
    isDev: true,
  });
  const production = loadApiUtils({
    apiUrl: 'http://192.168.1.65:3000/api/v1',
    isDev: false,
  });

  assert.equal(
    dev.normalizeAvatarFrameImageUrl(
      'http://localhost:9000/frames/diamond.png',
    ),
    'http://192.168.1.65:9000/frames/diamond.png',
  );
  assert.equal(
    dev.normalizeAvatarFrameImageUrl(
      'http://192.168.1.65:9000/frames/diamond.png',
    ),
    'http://192.168.1.65:9000/frames/diamond.png',
  );
  assert.equal(
    dev.normalizeAvatarFrameImageUrl('http://example.com/frame.png'),
    null,
  );
  assert.equal(
    production.normalizeAvatarFrameImageUrl(
      'http://192.168.1.65:9000/frames/diamond.png',
    ),
    null,
  );
});

test('embedded appearances safely null unsafe remote frame URLs', () => {
  const { normalizeAvatarFrameAppearance } = loadApiUtils({
    apiUrl: 'https://api.example.com/api/v1',
    isDev: false,
  });

  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        normalizeAvatarFrameAppearance({
          id: 'frame-1',
          key: 'event',
          name: 'Event',
          imageUrl: 'javascript:alert(1)',
        }),
      ),
    ),
    {
      id: 'frame-1',
      key: 'event',
      name: 'Event',
      imageUrl: null,
    },
  );
});
