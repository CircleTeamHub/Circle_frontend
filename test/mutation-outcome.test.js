const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadClassifier() {
  const filePath = path.join(
    process.cwd(),
    'src/services/api/mutation-outcome.ts',
  );
  const source = fs.readFileSync(filePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;
  const context = { module: { exports: {} }, exports: {} };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports.isAmbiguousMutationFailure;
}

test('网络失败和 5xx 属于结果不确定，明确 4xx 属于确定失败', () => {
  const isAmbiguousMutationFailure = loadClassifier();

  assert.equal(isAmbiguousMutationFailure(new Error('network failed')), true);
  assert.equal(isAmbiguousMutationFailure({ status: 0 }), true);
  assert.equal(isAmbiguousMutationFailure({ status: 500 }), true);
  assert.equal(isAmbiguousMutationFailure({ status: 503 }), true);
  assert.equal(isAmbiguousMutationFailure({ status: 400 }), false);
  assert.equal(isAmbiguousMutationFailure({ status: 409 }), false);
});

test('未知抛出值保守视为结果不确定', () => {
  const isAmbiguousMutationFailure = loadClassifier();

  assert.equal(isAmbiguousMutationFailure(null), true);
  assert.equal(isAmbiguousMutationFailure('connection reset'), true);
});
