const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function deferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function parse(value) {
  return JSON.parse(value);
}

function assertValidSecureStoreKey(key) {
  assert.match(key, /^[A-Za-z0-9._-]+$/);
}

function loadSecureAuthStorage({
  secureValues = {},
  legacyValues = {},
  failLegacyRemove = false,
  failSecureGet = false,
  failSecureStoreImport = false,
  pauseSecureDelete,
} = {}) {
  const filePath = path.join(process.cwd(), 'src/storage/secure-auth-storage.ts');
  const source = fs.readFileSync(filePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;

  const secure = { ...secureValues };
  const legacy = { ...legacyValues };
  const calls = [];

  const secureStore = {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
    getItemAsync: async (key) => {
      assertValidSecureStoreKey(key);
      calls.push(['secure:get', key]);
      if (failSecureGet) {
        throw new Error('secure get failed');
      }
      return Object.prototype.hasOwnProperty.call(secure, key)
        ? secure[key]
        : null;
    },
    setItemAsync: async (key, value, options) => {
      assertValidSecureStoreKey(key);
      calls.push(['secure:set', key, value, options]);
      secure[key] = value;
    },
    deleteItemAsync: async (key) => {
      assertValidSecureStoreKey(key);
      calls.push(['secure:delete', key]);
      if (pauseSecureDelete?.key === key) {
        pauseSecureDelete.started.resolve();
        await pauseSecureDelete.release.promise;
      }
      delete secure[key];
    },
  };

  const mmkvJsonStorage = {
    getItem: (key) => {
      calls.push(['legacy:get', key]);
      return Object.prototype.hasOwnProperty.call(legacy, key)
        ? legacy[key]
        : null;
    },
    setItem: (key, value) => {
      calls.push(['legacy:set', key, value]);
      legacy[key] = value;
    },
    removeItem: (key) => {
      calls.push(['legacy:remove', key]);
      if (failLegacyRemove) {
        throw new Error('legacy remove failed');
      }
      delete legacy[key];
    },
  };

  const context = {
    module: { exports: {} },
    exports: {},
    require: (request) => {
      if (request === 'expo-secure-store') {
        if (failSecureStoreImport) {
          throw new Error("Cannot find native module 'ExpoSecureStore'");
        }
        return secureStore;
      }
      if (request === '@/storage') return { mmkvJsonStorage };
      if (request === '@/stores/persisted-user') {
        return {
          sanitizeUserForPersist: (user) => ({
            ...user,
            email: null,
            phoneNumber: null,
            wechat: null,
            qq: null,
            whatsup: null,
            persona: null,
            helloWords: null,
            birthday: null,
            city: null,
          }),
        };
      }
      throw new Error(`Unexpected import: ${request}`);
    },
  };
  context.exports = context.module.exports;

  vm.runInNewContext(transpiled, context, { filename: filePath });
  return { ...context.module.exports, secure, legacy, calls };
}

test('secureAuthStorage loads when ExpoSecureStore native module is missing and rejects reads', async () => {
  const { secureAuthStorage } = loadSecureAuthStorage({
    failSecureStoreImport: true,
  });

  await assert.rejects(
    () => secureAuthStorage.getItem('circle-im-auth'),
    /Cannot find native module 'ExpoSecureStore'/,
  );
});

test('secureAuthStorage reads auth state from SecureStore before legacy MMKV', async () => {
  const { secureAuthStorage, legacy, calls } = loadSecureAuthStorage({
    secureValues: {
      'circle-im-auth.accessToken': 'secure',
      'circle-im-auth.refreshToken': 'refresh',
    },
    legacyValues: { 'circle-im-auth': '{"state":{"accessToken":"legacy"}}' },
  });

  const value = await secureAuthStorage.getItem('circle-im-auth');

  assert.equal(value, '{"state":{"accessToken":"secure","refreshToken":"refresh","imToken":null}}');
  assert.equal(legacy['circle-im-auth'], undefined);
  assert.deepEqual(calls, [
    ['legacy:get', 'circle-im-auth'],
    ['secure:get', 'circle-im-auth.accessToken'],
    ['secure:get', 'circle-im-auth.refreshToken'],
    ['secure:get', 'circle-im-auth.imToken'],
    ['legacy:remove', 'circle-im-auth'],
  ]);
});

test('secureAuthStorage migrates old MMKV auth state into SecureStore once', async () => {
  const legacyValue = '{"state":{"accessToken":"legacy","refreshToken":"refresh","imToken":"im","user":{"id":"u1","nickname":"Alice"},"isAuthenticated":true},"version":1}';
  const { secureAuthStorage, secure, legacy, calls } = loadSecureAuthStorage({
    legacyValues: { 'circle-im-auth': legacyValue },
  });

  const value = await secureAuthStorage.getItem('circle-im-auth');

  const migrated = parse(value);
  assert.equal(migrated.state.accessToken, 'legacy');
  assert.equal(migrated.state.refreshToken, 'refresh');
  assert.equal(migrated.state.imToken, 'im');
  assert.equal(migrated.state.user.id, 'u1');
  assert.equal(migrated.state.user.nickname, 'Alice');
  assert.equal(migrated.state.user.email, null);
  assert.equal(
    secure['circle-im-auth.accessToken'],
    'legacy',
  );
  assert.equal(
    secure['circle-im-auth.refreshToken'],
    'refresh',
  );
  assert.equal(
    secure['circle-im-auth.imToken'],
    'im',
  );
  assert.match(legacy['circle-im-auth'], /"nickname":"Alice"/);
  assert.doesNotMatch(legacy['circle-im-auth'], /legacy|refresh|"im"/);
  assert.deepEqual(calls[0], ['legacy:get', 'circle-im-auth']);
  assert.deepEqual(calls[1], ['secure:get', 'circle-im-auth.accessToken']);
  assert.ok(calls.some((call) => call[0] === 'secure:set' && call[1] === 'circle-im-auth.accessToken' && call[2] === 'legacy'));
  assert.ok(calls.some((call) => call[0] === 'secure:set' && call[1] === 'circle-im-auth.refreshToken' && call[2] === 'refresh'));
  assert.ok(calls.some((call) => call[0] === 'secure:set' && call[1] === 'circle-im-auth.imToken' && call[2] === 'im'));
  assert.ok(calls.some((call) => call[0] === 'secure:delete' && call[1] === 'circle-im-auth.tokens'));
  assert.ok(calls.some((call) => call[0] === 'legacy:set' && call[1] === 'circle-im-auth'));
  const accessSet = calls.find((call) => call[0] === 'secure:set' && call[1] === 'circle-im-auth.accessToken');
  assert.equal(
    accessSet[3].keychainAccessible,
    'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
  );
});

test('secureAuthStorage removes user PII while migrating legacy auth metadata', async () => {
  const legacyValue = JSON.stringify({
    state: {
      accessToken: 'legacy',
      refreshToken: 'refresh',
      user: {
        id: 'u1',
        nickname: 'Alice',
        email: 'alice@example.com',
        phoneNumber: '13800138000',
        birthday: '1990-01-01',
        city: 'Shanghai',
      },
    },
  });
  const { secureAuthStorage, legacy } = loadSecureAuthStorage({
    legacyValues: { 'circle-im-auth': legacyValue },
  });

  const value = parse(await secureAuthStorage.getItem('circle-im-auth'));

  assert.equal(value.state.user.nickname, 'Alice');
  assert.equal(value.state.user.email, null);
  assert.equal(value.state.user.phoneNumber, null);
  assert.equal(value.state.user.birthday, null);
  assert.equal(value.state.user.city, null);
  assert.doesNotMatch(legacy['circle-im-auth'], /alice@example\.com|13800138000|1990-01-01|Shanghai/);
});

test('secureAuthStorage writes only auth tokens to SecureStore and keeps user metadata sanitized in MMKV', async () => {
  const { secureAuthStorage, secure, legacy } = loadSecureAuthStorage({
    legacyValues: { 'circle-im-auth': '{"state":{"accessToken":"legacy"}}' },
  });

  await secureAuthStorage.setItem(
    'circle-im-auth',
    '{"state":{"accessToken":"next","refreshToken":"refresh","imToken":"im","user":{"id":"u1","nickname":"Alice","avatarUrl":"https://example.test/a/very/long/url.png"},"isAuthenticated":true},"version":1}',
  );

  assert.equal(
    secure['circle-im-auth.accessToken'],
    'next',
  );
  assert.equal(
    secure['circle-im-auth.refreshToken'],
    'refresh',
  );
  assert.equal(
    secure['circle-im-auth.imToken'],
    'im',
  );
  assert.match(legacy['circle-im-auth'], /"nickname":"Alice"/);
  assert.equal(secure['circle-im-auth.tokens'], undefined);
  assert.doesNotMatch(legacy['circle-im-auth'], /next|refresh|"im"/);
});

test('secureAuthStorage removeItem deletes SecureStore and legacy MMKV auth state', async () => {
  const { secureAuthStorage, secure, legacy } = loadSecureAuthStorage({
    secureValues: {
      'circle-im-auth.accessToken': 'secure',
      'circle-im-auth.refreshToken': 'refresh',
      'circle-im-auth.imToken': 'im',
      'circle-im-auth.tokens': '{"accessToken":"old","refreshToken":"old","imToken":null}',
    },
    legacyValues: { 'circle-im-auth': '{"state":{"accessToken":"legacy"}}' },
  });

  await secureAuthStorage.removeItem('circle-im-auth');

  assert.equal(secure['circle-im-auth.accessToken'], undefined);
  assert.equal(secure['circle-im-auth.refreshToken'], undefined);
  assert.equal(secure['circle-im-auth.imToken'], undefined);
  assert.equal(secure['circle-im-auth.tokens'], undefined);
  assert.equal(legacy['circle-im-auth'], undefined);
});

test('secureAuthStorage serializes a newer auth write behind an in-flight auth removal', async () => {
  const pauseSecureDelete = {
    key: 'circle-im-auth.accessToken',
    started: deferred(),
    release: deferred(),
  };
  const { secureAuthStorage, secure } = loadSecureAuthStorage({
    secureValues: {
      'circle-im-auth.accessToken': 'access-a',
      'circle-im-auth.refreshToken': 'refresh-a',
    },
    pauseSecureDelete,
  });

  const removing = secureAuthStorage.removeItem('circle-im-auth');
  await pauseSecureDelete.started.promise;
  const writing = secureAuthStorage.setItem(
    'circle-im-auth',
    '{"state":{"accessToken":"access-b","refreshToken":"refresh-b","isAuthenticated":true}}',
  );
  pauseSecureDelete.release.resolve();
  await Promise.all([removing, writing]);

  assert.equal(secure['circle-im-auth.accessToken'], 'access-b');
  assert.equal(secure['circle-im-auth.refreshToken'], 'refresh-b');
});

test('secureAuthStorage stores known-account tokens per account and keeps MMKV metadata token-free', async () => {
  const { secureAuthStorage, secure, legacy } = loadSecureAuthStorage();

  await secureAuthStorage.setItem(
    'circle-im-known-accounts',
    '{"state":{"accounts":[{"user":{"id":"u1","nickname":"Alice"},"accessToken":"a1","refreshToken":"r1","imToken":"i1","updatedAt":1},{"user":{"id":"u2","nickname":"Bob"},"accessToken":"a2","refreshToken":"r2","imToken":null,"updatedAt":2}]},"version":0}',
  );

  assert.equal(
    secure['circle-im-known-accounts.u1.accessToken'],
    'a1',
  );
  assert.equal(
    secure['circle-im-known-accounts.u1.refreshToken'],
    'r1',
  );
  assert.equal(
    secure['circle-im-known-accounts.u1.imToken'],
    'i1',
  );
  assert.equal(
    secure['circle-im-known-accounts.u2.accessToken'],
    'a2',
  );
  assert.equal(
    secure['circle-im-known-accounts.u2.refreshToken'],
    'r2',
  );
  assert.equal(secure['circle-im-known-accounts.u2.imToken'], undefined);
  assert.match(legacy['circle-im-known-accounts'], /Alice|Bob/);
  assert.doesNotMatch(legacy['circle-im-known-accounts'], /a1|r1|i1|a2|r2/);
});

test('secureAuthStorage removes user PII from known-account metadata', async () => {
  const { secureAuthStorage, legacy } = loadSecureAuthStorage();

  await secureAuthStorage.setItem(
    'circle-im-known-accounts',
    JSON.stringify({
      state: {
        accounts: [
          {
            user: {
              id: 'u1',
              nickname: 'Alice',
              email: 'alice@example.com',
              phoneNumber: '13800138000',
              city: 'Shanghai',
            },
            accessToken: 'a1',
            refreshToken: 'r1',
          },
        ],
      },
    }),
  );

  assert.match(legacy['circle-im-known-accounts'], /Alice/);
  assert.doesNotMatch(legacy['circle-im-known-accounts'], /alice@example\.com|13800138000|Shanghai/);
});

test('secureAuthStorage escapes known-account user ids before using them in SecureStore keys', async () => {
  const { secureAuthStorage, secure } = loadSecureAuthStorage();

  await secureAuthStorage.setItem(
    'circle-im-known-accounts',
    '{"state":{"accounts":[{"user":{"id":"alice@example.com","nickname":"Alice"},"accessToken":"a1","refreshToken":"r1","imToken":null}]}}',
  );

  assert.equal(
    secure['circle-im-known-accounts.alice_40_example.com.accessToken'],
    'a1',
  );
  assert.equal(
    secure['circle-im-known-accounts.alice_40_example.com.refreshToken'],
    'r1',
  );
});

test('secureAuthStorage ignores legacy MMKV cleanup failure after SecureStore read succeeds', async () => {
  const { secureAuthStorage } = loadSecureAuthStorage({
    secureValues: {
      'circle-im-auth.accessToken': 'secure',
      'circle-im-auth.refreshToken': 'refresh',
    },
    legacyValues: { 'circle-im-auth': '{"state":{"accessToken":"legacy"}}' },
    failLegacyRemove: true,
  });

  const value = await secureAuthStorage.getItem('circle-im-auth');

  assert.equal(value, '{"state":{"accessToken":"secure","refreshToken":"refresh","imToken":null}}');
});

test('secureAuthStorage preserves stored auth tokens when a degraded empty write follows a failed read', async () => {
  const { secureAuthStorage, secure } = loadSecureAuthStorage({
    secureValues: {
      'circle-im-auth.accessToken': 'secure',
      'circle-im-auth.refreshToken': 'refresh',
      'circle-im-auth.imToken': 'im',
    },
    legacyValues: { 'circle-im-auth': '{"state":{"user":{"id":"u1"}},"version":1}' },
    failSecureGet: true,
  });

  // hydration 读失败 → 抛错（persist 进入 error 分支）并进入 degraded
  await assert.rejects(() => secureAuthStorage.getItem('circle-im-auth'));

  // 随后 zustand 把空内存写回（onRehydrateStorage 的 setLoading 等触发）——
  // 绝不能删磁盘 token，否则一次读抖动就把用户永久登出
  await secureAuthStorage.setItem(
    'circle-im-auth',
    '{"state":{"accessToken":null,"refreshToken":null,"user":null,"isAuthenticated":false},"version":1}',
  );

  assert.equal(secure['circle-im-auth.accessToken'], 'secure');
  assert.equal(secure['circle-im-auth.refreshToken'], 'refresh');
  assert.equal(secure['circle-im-auth.imToken'], 'im');
});

test('secureAuthStorage still clears auth tokens on a normal (non-degraded) empty write', async () => {
  const { secureAuthStorage, secure } = loadSecureAuthStorage({
    secureValues: {
      'circle-im-auth.accessToken': 'a',
      'circle-im-auth.refreshToken': 'r',
    },
  });

  // 没有先发生读失败 → 非 degraded → 空态视为真实登出，照常清 token
  await secureAuthStorage.setItem(
    'circle-im-auth',
    '{"state":{"accessToken":null,"refreshToken":null,"isAuthenticated":false}}',
  );

  assert.equal(secure['circle-im-auth.accessToken'], undefined);
  assert.equal(secure['circle-im-auth.refreshToken'], undefined);
});

test('secureAuthStorage keeps other known-account tokens when a degraded write drops an account', async () => {
  const { secureAuthStorage, secure, legacy } = loadSecureAuthStorage({
    secureValues: {
      'circle-im-known-accounts.u1.accessToken': 'a1',
      'circle-im-known-accounts.u1.refreshToken': 'r1',
      'circle-im-known-accounts.u2.accessToken': 'a2',
      'circle-im-known-accounts.u2.refreshToken': 'r2',
    },
    legacyValues: {
      'circle-im-known-accounts':
        '{"state":{"accounts":[{"user":{"id":"u1","nickname":"Alice"}},{"user":{"id":"u2","nickname":"Bob"}}]}}',
    },
    failSecureGet: true,
  });

  // hydration 读失败 → degraded（内存只能载入部分/零个账号）
  await assert.rejects(() => secureAuthStorage.getItem('circle-im-known-accounts'));

  // 随后写回只剩 u1 的列表 —— 绝不能把 u2 的 Keychain 凭证当成「被移除」删掉
  await secureAuthStorage.setItem(
    'circle-im-known-accounts',
    '{"state":{"accounts":[{"user":{"id":"u1","nickname":"Alice"},"accessToken":"a1","refreshToken":"r1","imToken":null}]}}',
  );

  assert.equal(secure['circle-im-known-accounts.u2.accessToken'], 'a2');
  assert.equal(secure['circle-im-known-accounts.u2.refreshToken'], 'r2');
  // metadata 合并保留了 u2，下次成功 hydration 可恢复
  assert.match(legacy['circle-im-known-accounts'], /Bob/);
});

test('secureAuthStorage honors explicit known-account removal while degraded', async () => {
  const { secureAuthStorage, markKnownAccountRemoved, secure, legacy } =
    loadSecureAuthStorage({
      secureValues: {
        'circle-im-known-accounts.u1.accessToken': 'a1',
        'circle-im-known-accounts.u1.refreshToken': 'r1',
        'circle-im-known-accounts.u2.accessToken': 'a2',
        'circle-im-known-accounts.u2.refreshToken': 'r2',
      },
      legacyValues: {
        'circle-im-known-accounts':
          '{"state":{"accounts":[{"user":{"id":"u1","nickname":"Alice"}},{"user":{"id":"u2","nickname":"Bob"}}]}}',
      },
      failSecureGet: true,
    });

  await assert.rejects(() => secureAuthStorage.getItem('circle-im-known-accounts'));

  markKnownAccountRemoved('u2');
  await secureAuthStorage.setItem(
    'circle-im-known-accounts',
    '{"state":{"accounts":[{"user":{"id":"u1","nickname":"Alice"},"accessToken":"a1","refreshToken":"r1","imToken":null}]}}',
  );

  assert.equal(secure['circle-im-known-accounts.u1.accessToken'], 'a1');
  assert.equal(secure['circle-im-known-accounts.u2.accessToken'], undefined);
  assert.equal(secure['circle-im-known-accounts.u2.refreshToken'], undefined);
  assert.doesNotMatch(legacy['circle-im-known-accounts'], /Bob/);
});

test('secureAuthStorage prunes removed known-account tokens on a normal (non-degraded) write', async () => {
  const { secureAuthStorage, secure } = loadSecureAuthStorage({
    secureValues: {
      'circle-im-known-accounts.u1.accessToken': 'a1',
      'circle-im-known-accounts.u1.refreshToken': 'r1',
      'circle-im-known-accounts.u2.accessToken': 'a2',
      'circle-im-known-accounts.u2.refreshToken': 'r2',
    },
    legacyValues: {
      'circle-im-known-accounts':
        '{"state":{"accounts":[{"user":{"id":"u1"}},{"user":{"id":"u2"}}]}}',
    },
  });

  // 非 degraded：用户真的移除了 u2 → 应清掉 u2 的 token，避免凭证残留
  await secureAuthStorage.setItem(
    'circle-im-known-accounts',
    '{"state":{"accounts":[{"user":{"id":"u1"},"accessToken":"a1","refreshToken":"r1","imToken":null}]}}',
  );

  assert.equal(secure['circle-im-known-accounts.u1.accessToken'], 'a1');
  assert.equal(secure['circle-im-known-accounts.u2.accessToken'], undefined);
  assert.equal(secure['circle-im-known-accounts.u2.refreshToken'], undefined);
});
