const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadTsModule(relativePath) {
  const filePath = path.join(process.cwd(), relativePath);
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
  const context = { module: { exports: {} }, exports: {}, require, URL };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

const { resolveMessageScanResult } = loadTsModule(
  'src/features/messages/utils/scan-result.ts',
);

const plain = (value) => JSON.parse(JSON.stringify(value));

test('routes a whitelisted custom-scheme deep link', () => {
  assert.deepEqual(
    plain(resolveMessageScanResult('circleim://messages/temp-chats')), {
    type: 'route',
    href: '/(tabs)/messages/temp-chats',
  });
});

test('routes a whitelisted https universal link', () => {
  assert.deepEqual(
    plain(resolveMessageScanResult('https://circle.im/messages/add-friend')),
    { type: 'route', href: '/(tabs)/messages/add-friend' },
  );
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
