const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadTsModule(relativePath, stubs = {}) {
  const filePath = path.join(process.cwd(), relativePath);
  const source = fs.readFileSync(filePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      baseUrl: process.cwd(),
      paths: {
        '@/*': ['src/*'],
      },
    },
    fileName: filePath,
  }).outputText;

  const context = {
    module: { exports: {} },
    exports: {},
    require: (specifier) => {
      if (specifier in stubs) {
        return stubs[specifier];
      }

      return require(specifier);
    },
  };
  context.exports = context.module.exports;

  vm.runInNewContext(transpiled, context, { filename: filePath });

  return context.module.exports;
}

test('buildChatInfoState maps OpenIM conversation state into chat info UI values', () => {
  const { buildChatInfoState } = loadTsModule('src/features/chat/chat-info.ts');

  const state = buildChatInfoState({
    conversationID: 'c1',
    recvMsgOpt: 2,
    burnDuration: 60,
    isPinned: true,
  });

  assert.equal(state.pinned, true);
  assert.equal(state.muted, true);
  assert.equal(state.burnLabel, '1分钟');
});

test('buildChatInfoState falls back safely when conversation data is missing', () => {
  const { buildChatInfoState } = loadTsModule('src/features/chat/chat-info.ts');

  const state = buildChatInfoState(null);

  assert.equal(state.pinned, false);
  assert.equal(state.muted, false);
  assert.equal(state.burnLabel, '关闭');
});

test('buildChatInfoState maps short burn durations to their UI labels', () => {
  const { buildChatInfoState } = loadTsModule('src/features/chat/chat-info.ts');

  const state = buildChatInfoState({
    burnDuration: 10,
    recvMsgOpt: 0,
    isPinned: false,
  });

  assert.equal(state.burnLabel, '10秒');
  assert.equal(state.muted, false);
});
