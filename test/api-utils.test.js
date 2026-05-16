const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadApiUtils() {
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
    require: (specifier) => {
      if (specifier === '@/constants/config') {
        return { API_URL: 'https://api.example.com' };
      }

      if (specifier === '@/services/api/client') {
        return {
          apiClient: {},
          ApiError: class ApiError extends Error {},
        };
      }

      return require(specifier);
    },
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
  assert.equal(normalized.city, '杭州');
});
