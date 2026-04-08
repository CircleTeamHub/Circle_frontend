const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadSessionModule(mocks) {
  const filePath = path.join(process.cwd(), 'src/services/auth/session.ts');
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
      if (request in mocks) {
        return mocks[request];
      }
      throw new Error(`Unexpected import: ${request}`);
    },
  };
  context.exports = context.module.exports;

  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

test('clearLocalSession clears IM state, auth persistence, and message cache', async () => {
  const calls = [];
  const authStore = {
    getState: () => ({
      clearSession: () => {
        calls.push('clearSession');
      },
    }),
    persist: {
      clearStorage: async () => {
        calls.push('clearStorage');
      },
    },
  };
  const messageGroupsStore = {
    getState: () => ({
      reset: () => {
        calls.push('resetGroups');
      },
    }),
  };

  const { clearLocalSession } = loadSessionModule({
    '@/stores/authStore': { useAuthStore: authStore },
    '@/im/client': {
      logoutFromOpenIM: async () => {
        calls.push('logoutIM');
      },
    },
    '@/features/messages/store/use-message-groups-store': {
      useMessageGroupsStore: messageGroupsStore,
    },
  });

  await clearLocalSession();

  assert.deepEqual(calls, [
    'logoutIM',
    'resetGroups',
    'clearSession',
    'clearStorage',
  ]);
});

test('clearLocalSession still clears local state when IM logout fails', async () => {
  const calls = [];
  const authStore = {
    getState: () => ({
      clearSession: () => {
        calls.push('clearSession');
      },
    }),
    persist: {
      clearStorage: async () => {
        calls.push('clearStorage');
      },
    },
  };
  const messageGroupsStore = {
    getState: () => ({
      reset: () => {
        calls.push('resetGroups');
      },
    }),
  };

  const { clearLocalSession } = loadSessionModule({
    '@/stores/authStore': { useAuthStore: authStore },
    '@/im/client': {
      logoutFromOpenIM: async () => {
        calls.push('logoutIM');
        throw new Error('sdk logout failed');
      },
    },
    '@/features/messages/store/use-message-groups-store': {
      useMessageGroupsStore: messageGroupsStore,
    },
  });

  await clearLocalSession();

  assert.deepEqual(calls, [
    'logoutIM',
    'resetGroups',
    'clearSession',
    'clearStorage',
  ]);
});
