const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadAuthApi(apiClientMock) {
  const filePath = path.join(process.cwd(), 'src/services/api/auth.ts');
  const source = fs.readFileSync(filePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;

  const context = {
    module: { exports: {} },
    exports: {},
    require: (request) => {
      if (request === 'expo-device') {
        return {
          deviceName: 'iPhone 15 Pro',
          osName: 'iOS',
        };
      }

      if (request === '@/services/api/client') {
        return { apiClient: apiClientMock };
      }

      if (request === '@/services/api/utils') {
        return {
          normalizeUser: (value) => value,
        };
      }

      // react-native 只是为了拿 Platform.OS；测试里给个固定 iOS 即可。
      if (request === 'react-native') {
        return { Platform: { OS: 'ios' } };
      }

      throw new Error(`Unexpected import: ${request}`);
    },
  };
  context.exports = context.module.exports;

  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

test('changePassword posts old and new password to the auth endpoint', async () => {
  const calls = [];
  const apiClientMock = async (endpoint, options) => {
    calls.push({ endpoint, options });
    return {};
  };
  const { changePassword } = loadAuthApi(apiClientMock);

  await changePassword({
    oldPassword: 'old-password',
    newPassword: 'new-password',
  });

  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    {
      endpoint: '/auth/change-password',
      options: {
        method: 'POST',
        body: {
          oldPassword: 'old-password',
          newPassword: 'new-password',
        },
      },
    },
  ]);
});

test('changeAccountId patches the account id endpoint', async () => {
  const calls = [];
  const apiClientMock = async (endpoint, options) => {
    calls.push({ endpoint, options });
    return {};
  };
  const { changeAccountId } = loadAuthApi(apiClientMock);

  await changeAccountId('circle_1001');

  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    {
      endpoint: '/auth/account-id',
      options: {
        method: 'PATCH',
        body: {
          accountId: 'circle_1001',
        },
      },
    },
  ]);
});

test('logoutAll posts to the auth logout-all endpoint', async () => {
  const calls = [];
  const apiClientMock = async (endpoint, options) => {
    calls.push({ endpoint, options });
    return {};
  };
  const { logoutAll } = loadAuthApi(apiClientMock);

  await logoutAll();

  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    {
      endpoint: '/auth/logout-all',
      options: {
        method: 'POST',
      },
    },
  ]);
});

test('login trims accountId before sending to backend', async () => {
  const calls = [];
  const apiClientMock = async (endpoint, options) => {
    calls.push({ endpoint, options });
    return {
      accessToken: 'a-token',
      refreshToken: 'r-token',
      imToken: 'i-token',
    };
  };
  const { login } = loadAuthApi(apiClientMock);

  await login({ accountId: '  circle_1001  ', password: 'pw' });

  assert.equal(calls[0].options.body.accountId, 'circle_1001');
  assert.equal(calls[0].options.body.password, 'pw');
});

test('login normalizes missing/empty imToken to null', async () => {
  const apiClientMock = async () => ({
    accessToken: 'a-token',
    refreshToken: 'r-token',
    // backend can legitimately omit imToken for some account types
  });
  const { login } = loadAuthApi(apiClientMock);

  const tokens = await login({ accountId: 'a', password: 'p' });
  assert.equal(tokens.imToken, null, 'missing imToken should become null');

  const apiClientMock2 = async () => ({
    accessToken: 'a-token',
    refreshToken: 'r-token',
    imToken: '',
  });
  const { login: login2 } = loadAuthApi(apiClientMock2);
  const tokens2 = await login2({ accountId: 'a', password: 'p' });
  assert.equal(tokens2.imToken, null, 'empty imToken should become null');
});

test('login throws when accessToken or refreshToken missing (response shape drift guard)', async () => {
  // missing accessToken
  const { login: loginA } = loadAuthApi(async () => ({
    refreshToken: 'r-token',
    imToken: 'i-token',
  }));
  await assert.rejects(
    () => loginA({ accountId: 'a', password: 'p' }),
    /认证返回数据格式异常/
  );

  // backend sends snake_case (silent breakage in the old impl)
  const { login: loginB } = loadAuthApi(async () => ({
    access_token: 'a',
    refresh_token: 'r',
    im_token: 'i',
  }));
  await assert.rejects(
    () => loginB({ accountId: 'a', password: 'p' }),
    /认证返回数据格式异常/
  );

  // accessToken present but empty string
  const { login: loginC } = loadAuthApi(async () => ({
    accessToken: '',
    refreshToken: 'r-token',
  }));
  await assert.rejects(
    () => loginC({ accountId: 'a', password: 'p' }),
    /认证返回数据格式异常/
  );
});

test('register trims accountId and validates response shape', async () => {
  const calls = [];
  const apiClientMock = async (endpoint, options) => {
    calls.push(options.body);
    return {
      accessToken: 'a',
      refreshToken: 'r',
      imToken: null,
    };
  };
  const { register } = loadAuthApi(apiClientMock);

  const tokens = await register({
    accountId: '  newuser  ',
    password: 'pw',
    nickname: 'Hi',
  });

  assert.equal(calls[0].accountId, 'newuser');
  assert.equal(tokens.imToken, null);
});
