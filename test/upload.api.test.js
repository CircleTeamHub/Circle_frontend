const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadUploadApi() {
  const filePath = path.join(process.cwd(), 'src/services/api/upload.ts');
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
    require: (request) => {
      if (request === '@/services/api/client') {
        return {
          apiClient: (...args) => ({ mocked: true, args }),
        };
      }
      return require(request);
    },
  };
  context.exports = context.module.exports;

  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

test('upload helpers sanitize filenames and infer supported content types', () => {
  const { sanitizeUploadFilename, resolveUploadContentType } = loadUploadApi();

  assert.equal(
    sanitizeUploadFilename('my avatar(1).png'),
    'my-avatar-1-.png',
  );
  assert.equal(
    resolveUploadContentType({ mimeType: 'image/png', fileName: 'a.png' }),
    'image/png',
  );
  assert.equal(
    resolveUploadContentType({ mimeType: null, fileName: 'avatar.webp' }),
    'image/webp',
  );
});
