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

test('chat preview fallback only opens for known IM availability errors', () => {
  const { shouldOpenChatPreview } = loadTsModule(
    'src/features/chat/chat-preview.ts',
  );

  assert.equal(
    shouldOpenChatPreview(new Error('IM 连接尚未完成，请稍后重试')),
    true,
  );
  assert.equal(
    shouldOpenChatPreview(
      new Error('OpenIM 仅支持 iOS/Android development build'),
    ),
    true,
  );
  assert.equal(shouldOpenChatPreview(new Error('网络错误')), false);
  assert.equal(shouldOpenChatPreview(null), false);
});
