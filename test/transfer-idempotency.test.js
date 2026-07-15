const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadModule(keys) {
  const filePath = path.join(
    process.cwd(),
    'src/features/chat/utils/transfer-idempotency.ts',
  );
  const transpiled = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;
  const context = {
    module: { exports: {} },
    exports: {},
    require: (specifier) => {
      if (specifier === '@/utils/idempotency-key') {
        return { generateIdempotencyKey: () => keys.shift() };
      }
      throw new Error(`Unexpected import: ${specifier}`);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

test('transfer retries reuse the key for the same intent and rotate it after edits', () => {
  const { resolveTransferIdempotency } = loadModule(['key-1', 'key-2']);
  const intent = { recipientId: 'u1', amount: 10, message: 'hello' };

  const first = resolveTransferIdempotency(null, intent);
  const retry = resolveTransferIdempotency(first, intent);
  const edited = resolveTransferIdempotency(first, { ...intent, amount: 11 });

  assert.equal(first.key, 'key-1');
  assert.equal(retry.key, 'key-1');
  assert.equal(edited.key, 'key-2');
});

test('transfer composer passes the retained idempotency key to sendCoinGift', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/features/chat/screens/TransferComposerScreen.tsx'),
    'utf8',
  );

  assert.match(source, /resolveTransferIdempotency/);
  assert.match(source, /sendCoinGift\([\s\S]*?idempotencyKey:/);
});
