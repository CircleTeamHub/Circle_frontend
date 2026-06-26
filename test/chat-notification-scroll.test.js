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

const {
  getNotificationRestoreMaxMessages,
  hasMessageWithClientID,
} = load('src/features/chat/utils/notification-scroll.ts');

test('notification message navigation restores a deeper history window only when targeting a message', () => {
  assert.equal(getNotificationRestoreMaxMessages(''), 500);
  assert.equal(getNotificationRestoreMaxMessages('client-msg-1'), 2000);
});

test('notification message navigation checks the restored local message list by client id', () => {
  const messages = [
    { clientMsgID: 'older' },
    { clientMsgID: 'target' },
    { clientMsgID: '' },
  ];

  assert.equal(hasMessageWithClientID(messages, 'target'), true);
  assert.equal(hasMessageWithClientID(messages, 'missing'), false);
  assert.equal(hasMessageWithClientID(messages, ''), false);
});
