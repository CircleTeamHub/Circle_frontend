const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(rel) {
  const filePath = path.join(process.cwd(), rel);
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
    require: (specifier) => (specifier.startsWith('@/') ? {} : require(specifier)),
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

const { getShareCircleCardListState } = load(
  'src/features/discover/utils/share-circle-card.ts',
);

test('share circle card list state prioritizes loading, then error, then empty', () => {
  assert.equal(
    getShareCircleCardListState({
      loading: true,
      error: true,
      conversationCount: 0,
    }),
    'loading',
  );
  assert.equal(
    getShareCircleCardListState({
      loading: false,
      error: true,
      conversationCount: 0,
    }),
    'error',
  );
  assert.equal(
    getShareCircleCardListState({
      loading: false,
      error: false,
      conversationCount: 0,
    }),
    'empty',
  );
  assert.equal(
    getShareCircleCardListState({
      loading: false,
      error: true,
      conversationCount: 1,
    }),
    'ready',
  );
});
