const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadCacheModule(rnfsMock) {
  const filePath = path.join(process.cwd(), 'src/services/cache/clear-app-cache.ts');
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
      if (request === 'expo-file-system/legacy') {
        return {
          cacheDirectory: 'file:///app/cache/',
        };
      }

      if (request === 'react-native-fs') {
        return {
          __esModule: true,
          default: rnfsMock,
        };
      }

      if (request === 'react-native') {
        // clear-app-cache 只用 Platform.OS 判断是否走原生 FS 路径；
        // 这些用例都覆盖原生平台，所以 mock 成 'ios'。
        return {
          Platform: { OS: 'ios' },
        };
      }

      throw new Error(`Unexpected import: ${request}`);
    },
  };
  context.exports = context.module.exports;

  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

test('clearAppCache removes cache directory contents without clearing persistent storage', async () => {
  const calls = [];
  const rnfsMock = {
    CachesDirectoryPath: '/app/cache',
    TemporaryDirectoryPath: '/app/tmp',
    exists: async (target) => {
      calls.push(['exists', target]);
      return true;
    },
    readDir: async (target) => {
      calls.push(['readDir', target]);
      return [
        { path: `${target}/image.tmp` },
        { path: `${target}/upload.tmp` },
      ];
    },
    unlink: async (target) => {
      calls.push(['unlink', target]);
    },
  };

  const { clearAppCache } = loadCacheModule(rnfsMock);
  const result = await clearAppCache();

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    clearedEntries: 4,
    failedEntries: 0,
  });
  assert.deepEqual(
    calls.filter(([name]) => name === 'unlink').map(([, target]) => target),
    [
      '/app/cache/image.tmp',
      '/app/cache/upload.tmp',
      '/app/tmp/image.tmp',
      '/app/tmp/upload.tmp',
    ],
  );
});

test('getAppCacheSize recursively sums cache and temporary directories', async () => {
  const rnfsMock = {
    CachesDirectoryPath: '/app/cache',
    TemporaryDirectoryPath: '/app/tmp',
    exists: async () => true,
    readDir: async (target) => {
      if (target === '/app/cache') {
        return [
          { path: '/app/cache/a.tmp', size: 1024, isDirectory: () => false },
          { path: '/app/cache/nested', size: 0, isDirectory: () => true },
        ];
      }

      if (target === '/app/cache/nested') {
        return [
          { path: '/app/cache/nested/b.tmp', size: 1024 * 1024, isDirectory: () => false },
        ];
      }

      if (target === '/app/tmp') {
        return [
          { path: '/app/tmp/c.tmp', size: 1024 * 1024 * 2, isDirectory: () => false },
        ];
      }

      return [];
    },
    unlink: async () => undefined,
  };

  const { formatCacheSize, getAppCacheSize } = loadCacheModule(rnfsMock);
  const size = await getAppCacheSize();

  assert.equal(size, 3_146_752);
  assert.equal(formatCacheSize(size), '3 MB');
  assert.equal(formatCacheSize(0), '0 B');
});

test('clearAppCache skips denylisted entries that belong to system or other modules', async () => {
  const unlinked = [];
  const rnfsMock = {
    CachesDirectoryPath: '/app/cache',
    TemporaryDirectoryPath: '/app/tmp',
    exists: async () => true,
    readDir: async (target) => {
      if (target === '/app/cache') {
        return [
          { path: '/app/cache/image.tmp' },
          { path: '/app/cache/WebKit' },
          { path: '/app/cache/mmkv' },
          { path: '/app/cache/Cookies.binarycookies' },
        ];
      }
      if (target === '/app/tmp') {
        return [{ path: '/app/tmp/upload.tmp' }];
      }
      return [];
    },
    unlink: async (target) => {
      unlinked.push(target);
    },
  };

  const { clearAppCache } = loadCacheModule(rnfsMock);
  const result = await clearAppCache();

  assert.deepEqual(unlinked.sort(), ['/app/cache/image.tmp', '/app/tmp/upload.tmp']);
  assert.equal(result.clearedEntries, 2);
  assert.equal(result.failedEntries, 0);
});

test('getDirectorySize bounds recursion to defend against symlink loops', async () => {
  let readDirCalls = 0;
  const rnfsMock = {
    CachesDirectoryPath: '/app/cache',
    TemporaryDirectoryPath: '/app/tmp',
    exists: async () => true,
    readDir: async (target) => {
      readDirCalls += 1;
      // Each level recurses one more level deep, simulating a symlink loop.
      if (target === '/app/tmp') return [];
      return [
        { path: `${target}/loop`, size: 0, isDirectory: () => true },
        { path: `${target}/file`, size: 100, isDirectory: () => false },
      ];
    },
    unlink: async () => undefined,
  };

  const { getAppCacheSize } = loadCacheModule(rnfsMock);
  await getAppCacheSize();

  // 17 readDir calls for /app/cache (depth 0..16) + 1 for /app/tmp.
  assert.ok(readDirCalls <= 20, `expected bounded recursion, got ${readDirCalls}`);
});

test('getAppStorageUsage separates chat storage from cache storage', async () => {
  const rnfsMock = {
    DocumentDirectoryPath: '/app/documents',
    CachesDirectoryPath: '/app/cache',
    TemporaryDirectoryPath: '/app/tmp',
    exists: async () => true,
    readDir: async (target) => {
      if (target === '/app/documents/openim') {
        return [
          { path: '/app/documents/openim/message.db', size: 1024 * 1024 * 4, isDirectory: () => false },
        ];
      }

      if (target === '/app/cache') {
        return [
          { path: '/app/cache/image.tmp', size: 1024 * 2, isDirectory: () => false },
        ];
      }

      if (target === '/app/tmp') {
        return [
          { path: '/app/tmp/upload.tmp', size: 1024 * 3, isDirectory: () => false },
        ];
      }

      return [];
    },
    unlink: async () => undefined,
  };

  const { getAppStorageUsage } = loadCacheModule(rnfsMock);
  const usage = await getAppStorageUsage();

  assert.deepEqual(JSON.parse(JSON.stringify(usage)), {
    chatBytes: 4_194_304,
    cacheBytes: 2_048,
    temporaryBytes: 3_072,
    totalBytes: 4_199_424,
  });
});
