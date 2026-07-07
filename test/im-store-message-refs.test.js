// 锁住 ChatDetailScreen 的 WeakMap 映射缓存所依赖的前提：
// imStore 对消息的每次「变更」都必须返回**新的 MessageItem 引用**，
// 且未变消息保持**同一引用**。若哪天有人把某个 reducer 改成原地 mutate，
// 缓存会命中旧结果、对应气泡的已读态/失败态永不更新——这个测试会先红。
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
      paths: { '@/*': ['src/*'] },
    },
    fileName: filePath,
  }).outputText;
  const context = {
    module: { exports: {} },
    exports: {},
    require: (specifier) =>
      specifier in stubs ? stubs[specifier] : require(specifier),
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

const SDK_STUB = {
  __esModule: true,
  MessageStatus: { Sending: 1, Succeed: 2, Failed: 3 },
  OnlineState: { Offline: 0, Online: 1 },
};

function loadStore() {
  const { useIMStore } = loadTsModule('src/stores/imStore.ts', {
    '@openim/rn-client-sdk': SDK_STUB,
  });
  return useIMStore;
}

function msg(clientMsgID, overrides = {}) {
  return {
    clientMsgID,
    serverMsgID: `s-${clientMsgID}`,
    sendID: 'me',
    recvID: 'peer',
    sessionType: 1,
    contentType: 101,
    sendTime: 1000,
    createTime: 900,
    content: '{}',
    isRead: false,
    status: 2,
    ...overrides,
  };
}

test('markMessagesRead 给变更消息换新引用、未变消息保持同一引用', () => {
  const useIMStore = loadStore();
  const a = msg('a');
  const b = msg('b');
  useIMStore.getState().appendMessages('conv1', [a, b]);
  const before = useIMStore.getState().messagesByConversation.conv1;
  const aRef = before.find((m) => m.clientMsgID === 'a');
  const bRef = before.find((m) => m.clientMsgID === 'b');

  useIMStore.getState().markMessagesRead('conv1', ['a']);

  const after = useIMStore.getState().messagesByConversation.conv1;
  const aAfter = after.find((m) => m.clientMsgID === 'a');
  const bAfter = after.find((m) => m.clientMsgID === 'b');

  // 变更行：新引用（WeakMap 缓存会 miss → 该行重渲染）
  assert.notEqual(aAfter, aRef, 'read 变更的消息必须是新引用');
  assert.equal(aAfter.isRead, true);
  // 未变行：同一引用（WeakMap 命中 → 跳过重渲染，正是性能收益来源）
  assert.equal(bAfter, bRef, '未变更的消息必须保持同一引用');
});

test('markMessageSendFailed 给失败消息换新引用并置 Failed 态', () => {
  const useIMStore = loadStore();
  const a = msg('a', { status: 1 }); // Sending
  const b = msg('b', { status: 2 });
  useIMStore.getState().appendMessages('conv1', [a, b]);
  const before = useIMStore.getState().messagesByConversation.conv1;
  const aRef = before.find((m) => m.clientMsgID === 'a');
  const bRef = before.find((m) => m.clientMsgID === 'b');

  useIMStore.getState().markMessageSendFailed('conv1', 'a');

  const after = useIMStore.getState().messagesByConversation.conv1;
  const aAfter = after.find((m) => m.clientMsgID === 'a');
  const bAfter = after.find((m) => m.clientMsgID === 'b');

  assert.notEqual(aAfter, aRef, '失败变更的消息必须是新引用');
  assert.equal(aAfter.status, 3, 'status 应为 MessageStatus.Failed');
  assert.equal(bAfter, bRef, '未涉及的消息必须保持同一引用');
});

test('无实际变更时 reducer 不应产生新引用（避免全列表重渲染）', () => {
  const useIMStore = loadStore();
  const a = msg('a', { isRead: true }); // 已读，再 markRead 应无变化
  useIMStore.getState().appendMessages('conv1', [a]);
  const before = useIMStore.getState().messagesByConversation.conv1;

  useIMStore.getState().markMessagesRead('conv1', ['a']);

  const after = useIMStore.getState().messagesByConversation.conv1;
  assert.equal(after, before, '无变更时应返回同一数组引用');
});
