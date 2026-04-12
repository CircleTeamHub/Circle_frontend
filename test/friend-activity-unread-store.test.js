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

test('friend activity unread store refreshes count from API and decrements after marking read', async () => {
  const { useFriendActivityUnreadStore } = loadTsModule(
    'src/stores/friendActivityUnreadStore.ts',
    {
      '@/services/api/friends': {
        fetchUnreadFriendActivityCount: async () => 3,
      },
    },
  );

  await useFriendActivityUnreadStore.getState().refresh();
  assert.equal(useFriendActivityUnreadStore.getState().count, 3);

  useFriendActivityUnreadStore.getState().markRead(['a-1', 'a-2']);
  assert.equal(useFriendActivityUnreadStore.getState().count, 1);
});

test('friend activity unread store keeps the last known count when refresh fails', async () => {
  const { useFriendActivityUnreadStore } = loadTsModule(
    'src/stores/friendActivityUnreadStore.ts',
    {
      '@/services/api/friends': {
        fetchUnreadFriendActivityCount: async () => {
          throw new Error('network');
        },
      },
    },
  );

  useFriendActivityUnreadStore.setState({ count: 4 });
  await useFriendActivityUnreadStore.getState().refresh();

  assert.equal(useFriendActivityUnreadStore.getState().count, 4);
});
