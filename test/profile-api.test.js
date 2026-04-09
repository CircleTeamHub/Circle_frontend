const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadProfileApi(deps) {
  const filePath = path.join(process.cwd(), 'src/services/api/profile.ts');
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
      if (request === '@/services/api/client') {
        return { apiClient: deps.apiClient };
      }

      if (request === '@/services/api/auth') {
        return {
          fetchCurrentUser: deps.fetchCurrentUser,
        };
      }

      if (request === '@/services/api/utils') {
        return {
          normalizeUser: deps.normalizeUser,
        };
      }

      throw new Error(`Unexpected import: ${request}`);
    },
  };
  context.exports = context.module.exports;

  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

test('updateUserProfile refreshes current user after patch when patch response is empty', async () => {
  const calls = [];
  const patchResponse = undefined;
  const refreshedUser = { id: 'user-1', city: '杭州' };
  const { updateUserProfile } = loadProfileApi({
    apiClient: async (endpoint, options) => {
      calls.push({ endpoint, options });
      return patchResponse;
    },
    fetchCurrentUser: async () => refreshedUser,
    normalizeUser: (value) => value,
  });

  const result = await updateUserProfile('user-1', { city: '杭州' });

  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    {
      endpoint: '/user/user-1',
      options: {
        method: 'PATCH',
        body: {
          city: '杭州',
        },
      },
    },
  ]);
  assert.equal(result.city, '杭州');
});

test('updateUserProfile keeps the submitted city when refresh returns stale data', async () => {
  const { updateUserProfile } = loadProfileApi({
    apiClient: async () => ({ id: 'user-1', city: null }),
    fetchCurrentUser: async () => ({ id: 'user-1', city: null }),
    normalizeUser: (value) => value,
  });

  const result = await updateUserProfile(
    'user-1',
    { city: '杭州' },
    { id: 'user-1', city: null },
  );

  assert.equal(result.city, '杭州');
});
