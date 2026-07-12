const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadIMStore() {
  const filePath = path.join(process.cwd(), 'src/stores/imStore.ts');
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
      if (request === 'zustand') {
        return {
          create: (initializer) => {
            const state = {};
            const set = (partial) => {
              const next =
                typeof partial === 'function' ? partial(state) : partial;
              Object.assign(state, next);
            };
            const get = () => state;
            Object.assign(state, initializer(set, get));
            return {
              getState: get,
              setState: set,
            };
          },
        };
      }
      if (request === '@openim/rn-client-sdk') {
        return { OnlineState: {} };
      }
      throw new Error(`Unexpected import: ${request}`);
    },
  };
  context.exports = context.module.exports;

  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports.useIMStore;
}

test('appendMessages replaces optimistic and sent messages with the same clientMsgID', () => {
  const useIMStore = loadIMStore();
  const optimistic = {
    clientMsgID: 'client-1',
    sendTime: 100,
    status: 1,
    content: 'pending',
  };
  const sent = {
    clientMsgID: 'client-1',
    sendTime: 100,
    status: 2,
    content: 'sent',
  };

  useIMStore.getState().setMessages('conv-1', [optimistic]);
  useIMStore.getState().appendMessages('conv-1', [sent]);

  const list = useIMStore.getState().messagesByConversation['conv-1'];
  assert.equal(list.length, 1);
  assert.equal(list[0], sent);
  assert.equal(list[0].status, 2);
});

test('markMessageSendFailed changes only the target message reference', () => {
  const useIMStore = loadIMStore();
  const target = { clientMsgID: 'client-1', sendTime: 100, status: 1 };
  const unaffected = { clientMsgID: 'client-2', sendTime: 101, status: 2 };

  useIMStore.getState().setMessages('conv-1', [target, unaffected]);
  useIMStore.getState().markMessageSendFailed('conv-1', 'client-1');

  const list = useIMStore.getState().messagesByConversation['conv-1'];
  assert.notEqual(list[0], target);
  assert.equal(list[0].status, 3);
  assert.equal(list[1], unaffected);
});
