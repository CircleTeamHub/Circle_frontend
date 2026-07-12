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
  const context = {
    module: { exports: {} },
    exports: {},
    require,
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

const { stampOptimisticMessage: stamp } = loadTsModule(
  'src/features/chat/utils/optimistic-message.ts',
);

test('stamps missing and invalid optimistic message timestamps', () => {
  assert.equal(stamp({ sendTime: 0 }, 5000).sendTime, 5000);
  assert.equal(stamp({}, 5000).sendTime, 5000);
  assert.equal(stamp({ sendTime: -1 }, 5000).sendTime, 5000);
  assert.equal(stamp({ sendTime: Number.NaN }, 5000).sendTime, 5000);
  assert.equal(stamp({ sendTime: Number.POSITIVE_INFINITY }, 5000).sendTime, 5000);
});

test('preserves valid optimistic message timestamps and object identity', () => {
  const message = { sendTime: 42, content: 'hello' };

  assert.equal(stamp(message, 5000), message);
  assert.equal(stamp(message, 5000).sendTime, 42);
});
