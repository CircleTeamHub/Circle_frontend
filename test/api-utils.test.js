const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadApiUtils(apiUrl) {
  const filePath = path.join(process.cwd(), 'src/services/api/utils.ts');
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
    URL,
    require: (request) => {
      if (request === '@/constants/config') {
        return { API_URL: apiUrl };
      }
      return {};
    },
  };
  context.exports = context.module.exports;

  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

test('normalizeMediaUrl rewrites localhost asset URLs to the active API host', () => {
  const { normalizeMediaUrl } = loadApiUtils('http://10.0.0.195:3000/api/v1');

  assert.equal(
    normalizeMediaUrl('http://localhost:9000/circle/avatars/test.jpg'),
    'http://10.0.0.195:9000/circle/avatars/test.jpg',
  );
  assert.equal(
    normalizeMediaUrl('http://127.0.0.1:9000/circle/avatars/test.jpg'),
    'http://10.0.0.195:9000/circle/avatars/test.jpg',
  );
});

test('normalizeMediaUrl keeps already-public URLs unchanged', () => {
  const { normalizeMediaUrl } = loadApiUtils('http://10.0.0.195:3000/api/v1');

  assert.equal(
    normalizeMediaUrl('http://10.0.0.195:9000/circle/avatars/test.jpg'),
    'http://10.0.0.195:9000/circle/avatars/test.jpg',
  );
  assert.equal(
    normalizeMediaUrl('https://cdn.example.com/avatar.png'),
    'https://cdn.example.com/avatar.png',
  );
});
