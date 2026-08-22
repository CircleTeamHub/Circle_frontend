const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const moduleCache = new Map();

function resolveTsModule(request, parentFilePath) {
  const basePath = request.startsWith('.')
    ? path.resolve(path.dirname(parentFilePath), request)
    : path.join(process.cwd(), request);
  for (const candidate of [basePath, `${basePath}.ts`, `${basePath}.tsx`]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function loadTsModule(relativeOrAbsolutePath) {
  const filePath = path.isAbsolute(relativeOrAbsolutePath)
    ? relativeOrAbsolutePath
    : path.join(process.cwd(), relativeOrAbsolutePath);
  if (moduleCache.has(filePath)) return moduleCache.get(filePath);

  const source = fs.readFileSync(filePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;

  // expo-router resolves URL via the runtime; expose it so the parsing path is
  // actually exercised (a bare VM realm has no URL global).
  const module = { exports: {} };
  moduleCache.set(filePath, module.exports);
  const localRequire = (request) => {
    const resolvedTsModule = resolveTsModule(request, filePath);
    return resolvedTsModule ? loadTsModule(resolvedTsModule) : require(request);
  };
  const context = { module, exports: module.exports, require: localRequire, URL };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  moduleCache.set(filePath, context.module.exports);
  return context.module.exports;
}

const { resolveMessageScanResult } = loadTsModule(
  'src/features/messages/utils/scan-result.ts',
);

const plain = (value) => JSON.parse(JSON.stringify(value));

test('routes a whitelisted custom-scheme deep link', () => {
  assert.deepEqual(
    plain(resolveMessageScanResult('windnoteai://messages/temp-chats')), {
    type: 'route',
    href: '/(tabs)/messages/temp-chats',
  });
});

test('keeps routing legacy custom-scheme deep links', () => {
  assert.deepEqual(
    plain(resolveMessageScanResult('circleim://messages/temp-chats')), {
    type: 'route',
    href: '/(tabs)/messages/temp-chats',
  });
});

test('routes a whitelisted https universal link', () => {
  assert.deepEqual(
    plain(resolveMessageScanResult('https://windnote.ai/messages/add-friend')),
    { type: 'route', href: '/(tabs)/messages/add-friend' },
  );
});

test('routes versioned login QR payloads separately from join QR payloads', () => {
  const token = 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6';
  assert.deepEqual(
    plain(resolveMessageScanResult(`windnoteai://qr-login?t=${token}`)),
    {
      type: 'route',
      href: { pathname: '/qr-login', params: { t: token } },
    },
  );
});

test('keeps routing legacy https universal links', () => {
  assert.deepEqual(
    plain(resolveMessageScanResult('https://circle.im/messages/add-friend')),
    { type: 'route', href: '/(tabs)/messages/add-friend' },
  );
});

test('does NOT route http universal links', () => {
  const value = 'http://windnote.ai/messages/add-friend';
  assert.deepEqual(
    plain(resolveMessageScanResult(value)), { type: 'copy', value });
});

test('routes a bare in-app path', () => {
  assert.deepEqual(
    plain(resolveMessageScanResult('/(tabs)/messages/groups')), {
    type: 'route',
    href: '/(tabs)/messages/groups',
  });
});

test('does NOT route an unknown path under our host (no open redirect)', () => {
  assert.deepEqual(
    plain(resolveMessageScanResult('circleim://messages/delete-account')),
    { type: 'copy', value: 'circleim://messages/delete-account' },
  );
});

test('does NOT route a look-alike host', () => {
  const value = 'https://circle.im.evil.com/messages/add-friend';
  assert.deepEqual(
    plain(resolveMessageScanResult(value)), { type: 'copy', value });
});

test('falls back to copy for arbitrary text and trims it', () => {
  assert.deepEqual(
    plain(resolveMessageScanResult('  hello world  ')), {
    type: 'copy',
    value: 'hello world',
  });
});

test('falls back to copy for a foreign url', () => {
  assert.deepEqual(
    plain(resolveMessageScanResult('https://example.com/x')), {
    type: 'copy',
    value: 'https://example.com/x',
  });
});
