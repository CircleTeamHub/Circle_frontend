const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadProfileDisplay() {
  const filePath = path.join(
    process.cwd(),
    'src/features/profile/profile-display.ts',
  );
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

test('persona takes precedence over helloWords in profile signature display', () => {
  const { getProfileSignature } = loadProfileDisplay();

  assert.equal(getProfileSignature('新的简介', '旧的招呼语'), '新的简介');
  assert.equal(getProfileSignature('', '旧的招呼语'), '旧的招呼语');
  assert.match(getProfileSignature('', ''), /完善资料后会在这里展示你的介绍/);
});
