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

// 扫码页在消息、通讯录两个栈各有一份:识别出的应用内结果留在扫码页所在的栈里。
const SCAN_SCOPES = ['messages', 'contacts'];

test('routes a whitelisted custom-scheme deep link', () => {
  for (const scope of SCAN_SCOPES) {
    assert.deepEqual(
      plain(resolveMessageScanResult('windnoteai://messages/temp-chats', scope)), {
      type: 'route',
      href: `/(tabs)/${scope}/temp-chats`,
    });
  }
});

test('keeps routing legacy custom-scheme deep links', () => {
  for (const scope of SCAN_SCOPES) {
    assert.deepEqual(
      plain(resolveMessageScanResult('circleim://messages/temp-chats', scope)), {
      type: 'route',
      href: `/(tabs)/${scope}/temp-chats`,
    });
  }
});

test('routes a whitelisted https universal link', () => {
  for (const scope of SCAN_SCOPES) {
    assert.deepEqual(
      plain(resolveMessageScanResult('https://windnote.ai/messages/add-friend', scope)),
      { type: 'route', href: `/(tabs)/${scope}/add-friend` },
    );
  }
});

test('routes versioned login QR payloads separately from join QR payloads', () => {
  const token = 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6';
  for (const scope of SCAN_SCOPES) {
    assert.deepEqual(
      plain(resolveMessageScanResult(`windnoteai://qr-login?t=${token}`, scope)),
      {
        type: 'route',
        href: {
          pathname: `/(tabs)/${scope}/qr-login`,
          params: { t: token },
        },
      },
    );
  }
});

test('keeps an in-app contact QR result inside the scanning stack', () => {
  const token = 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6';
  for (const scope of SCAN_SCOPES) {
    assert.deepEqual(
      plain(resolveMessageScanResult(`windnoteai://qr?t=${token}`, scope)),
      {
        type: 'route',
        href: {
          pathname: `/(tabs)/${scope}/qr`,
          params: { t: token },
        },
      },
    );
  }
});

test('keeps routing legacy https universal links', () => {
  for (const scope of SCAN_SCOPES) {
    assert.deepEqual(
      plain(resolveMessageScanResult('https://circle.im/messages/add-friend', scope)),
      { type: 'route', href: `/(tabs)/${scope}/add-friend` },
    );
  }
});

test('routes retired QR-login links to the in-app compatibility screen', () => {
  const value = 'windnoteai://qr-login?t=ABCDEFGHIJKLMNOP';
  for (const scope of SCAN_SCOPES) {
    assert.deepEqual(
      plain(resolveMessageScanResult(value, scope)),
      {
        type: 'route',
        href: {
          pathname: `/(tabs)/${scope}/qr-login`,
          params: { t: 'ABCDEFGHIJKLMNOP' },
        },
      },
    );
  }
});

test('does NOT route http universal links', () => {
  const value = 'http://windnote.ai/messages/add-friend';
  assert.deepEqual(
    plain(resolveMessageScanResult(value, 'messages')), { type: 'copy', value });
});

test('routes a bare in-app path', () => {
  for (const scope of SCAN_SCOPES) {
    assert.deepEqual(
      plain(resolveMessageScanResult('/(tabs)/messages/groups', scope)), {
      type: 'route',
      href: `/(tabs)/${scope}/groups`,
    });
  }
});

test('every routed scan result exists in both scanning stacks', () => {
  for (const scope of SCAN_SCOPES) {
    assert.ok(fs.existsSync(path.join(process.cwd(), `app/(tabs)/${scope}/scan.tsx`)), `${scope} 栈缺扫码页`);
    for (const page of ['qr', 'qr-login', 'add-friend', 'find', 'groups', 'temp-chats']) {
      const base = path.join(process.cwd(), `app/(tabs)/${scope}/${page}`);
      assert.ok(
        fs.existsSync(`${base}.tsx`) || fs.existsSync(path.join(base, 'index.tsx')),
        `${scope} 栈缺 ${page}`,
      );
    }
  }
});

test('does NOT route an unknown path under our host (no open redirect)', () => {
  for (const scope of SCAN_SCOPES) {
    assert.deepEqual(
      plain(resolveMessageScanResult('circleim://messages/delete-account', scope)),
      { type: 'copy', value: 'circleim://messages/delete-account' },
    );
  }
});

test('does NOT route a look-alike host', () => {
  const value = 'https://circle.im.evil.com/messages/add-friend';
  assert.deepEqual(
    plain(resolveMessageScanResult(value, 'contacts')), { type: 'copy', value });
});

test('falls back to copy for arbitrary text and trims it', () => {
  assert.deepEqual(
    plain(resolveMessageScanResult('  hello world  ', 'messages')), {
    type: 'copy',
    value: 'hello world',
  });
});

test('falls back to copy for a foreign url', () => {
  assert.deepEqual(
    plain(resolveMessageScanResult('https://example.com/x', 'contacts')), {
    type: 'copy',
    value: 'https://example.com/x',
  });
});
