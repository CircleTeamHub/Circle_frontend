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
