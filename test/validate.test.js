const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadValidate() {
  const filePath = path.join(process.cwd(), 'src/utils/validate.ts');
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
    require: () => {
      throw new Error('validate.ts should have no imports');
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

test('isPlainObject rejects null, arrays, primitives; accepts plain objects', () => {
  const { isPlainObject } = loadValidate();
  assert.equal(isPlainObject({}), true);
  assert.equal(isPlainObject({ a: 1 }), true);
  assert.equal(isPlainObject(null), false);
  assert.equal(isPlainObject(undefined), false);
  assert.equal(isPlainObject([1, 2]), false);
  assert.equal(isPlainObject('string'), false);
  assert.equal(isPlainObject(42), false);
});

test('isNonEmptyString — empty string fails, whitespace-only passes (only checks length)', () => {
  const { isNonEmptyString } = loadValidate();
  assert.equal(isNonEmptyString(''), false);
  assert.equal(isNonEmptyString('hello'), true);
  assert.equal(isNonEmptyString(' '), true); // by design
  assert.equal(isNonEmptyString(null), false);
  assert.equal(isNonEmptyString(0), false);
});

test('isFiniteNumber — NaN / Infinity / strings rejected', () => {
  const { isFiniteNumber } = loadValidate();
  assert.equal(isFiniteNumber(0), true);
  assert.equal(isFiniteNumber(-5), true);
  assert.equal(isFiniteNumber(3.14), true);
  assert.equal(isFiniteNumber(NaN), false);
  assert.equal(isFiniteNumber(Infinity), false);
  assert.equal(isFiniteNumber(-Infinity), false);
  assert.equal(isFiniteNumber('5'), false);
  assert.equal(isFiniteNumber(null), false);
});

test('isFiniteNonNegativeNumber — negative numbers rejected', () => {
  const { isFiniteNonNegativeNumber } = loadValidate();
  assert.equal(isFiniteNonNegativeNumber(0), true);
  assert.equal(isFiniteNonNegativeNumber(100), true);
  assert.equal(isFiniteNonNegativeNumber(-0.1), false);
  assert.equal(isFiniteNonNegativeNumber(-100), false);
  assert.equal(isFiniteNonNegativeNumber(NaN), false);
});

test('expectShape returns value when predicate passes', () => {
  const { expectShape, isPlainObject } = loadValidate();
  const input = { a: 1 };
  assert.equal(expectShape(input, isPlainObject, 'should not throw'), input);
});

test('expectShape throws with the given message when predicate fails', () => {
  const { expectShape, isPlainObject } = loadValidate();
  assert.throws(
    () => expectShape(null, isPlainObject, '数据格式异常'),
    /数据格式异常/,
  );
});
