const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

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
      if (specifier in stubs) return stubs[specifier];
      // 观测层在测试里是无副作用桩：源码依赖它但 node 无法解析路径别名/原生 Sentry。
      if (specifier === '@/observability/sentry') {
        return { reportError: () => {} };
      }
      return require(specifier);
    },
    Date,
    Error,
    Map,
    Promise,
    setTimeout,
    clearTimeout,
  };
  context.exports = context.module.exports;

  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

test('credit policy is local-only: no abandoned server-check surface', () => {
  // Option A（见 circle_be docs/credit-gate.md）：聊天层信誉只做客户端 UX 拦截，
  // 不查服务端。守住这个边界，防止「每条发消息打后端」的老方案被重新引入。
  const source = read('src/services/api/credit-policy.ts');

  assert.doesNotMatch(source, /assertCanSendMessage/);
  assert.doesNotMatch(source, /checkCreditPolicy/);
  assert.doesNotMatch(source, /\/credit-policy\/check/);
  assert.doesNotMatch(source, /apiClient/);
});


test('chat detail surfaces low-credit policy errors as the send error text', () => {
  // 映射本身住在 chat-core/send-errors.ts(屏幕只负责调用并显示)。
  const source = read('src/features/chat/screens/ChatDetailScreen.tsx');
  const mapper = read('src/chat-core/send-errors.ts');

  assert.match(source, /getChatSendErrorMessage/);
  assert.match(mapper, /CreditPolicyError/);
  assert.match(mapper, /error instanceof CreditPolicyError/);
});

test('chat detail checks only local credit state before uploading image messages', () => {
  const source = read('src/features/chat/screens/ChatDetailScreen.tsx');
  const uploadBlock =
    source.match(/const uploadAndSendImageAsset = useCallback\([\s\S]*?\n  \);/)?.[0] ??
    '';

  assert.match(uploadBlock, /assertLocalCanSendMessage/);
  assert.doesNotMatch(uploadBlock, /await assertCanSendMessage/);
  assert.match(uploadBlock, /requestUploadPresign/);
  assert.ok(
    uploadBlock.indexOf('assertLocalCanSendMessage') <
      uploadBlock.indexOf('requestUploadPresign'),
    'local credit state must be checked before expensive image upload work',
  );
});

test('assertLocalCanSendMessage fails open (allows) when credit score is unavailable', () => {
  const reported = [];
  const creditPolicy = loadTsModule('src/services/api/credit-policy.ts', {
    '@/services/api/client': { apiClient: async () => ({}) },
    '@/stores/authStore': {
      useAuthStore: { getState: () => ({ user: {} }) }, // creditScore 缺失
    },
    '@/observability/sentry': { reportError: (e, ctx) => reported.push(ctx) },
  });

  // 分数未知 → 放行（不抛），且上报一次可观测事件。
  assert.doesNotThrow(() => creditPolicy.assertLocalCanSendMessage());
  assert.equal(reported.length, 1);
  assert.equal(reported[0].kind, 'scoreUnavailable');
});

test('credit gate telemetry reports each event at most once per session', () => {
  const reported = [];
  const creditPolicy = loadTsModule('src/services/api/credit-policy.ts', {
    '@/services/api/client': { apiClient: async () => ({}) },
    '@/stores/authStore': {
      useAuthStore: { getState: () => ({ user: { creditScore: 30 } }) },
    },
    '@/observability/sentry': { reportError: (e, ctx) => reported.push(ctx) },
  });

  // 高频发送不应刷量：多次拦截只上报一次。
  for (let i = 0; i < 5; i += 1) {
    assert.throws(() => creditPolicy.assertLocalCanSendMessage(), /CreditPolicyError/);
  }
  assert.equal(reported.length, 1);
  assert.equal(reported[0].kind, 'blockSend');

  // reset 后可再次上报（测试隔离能力）。
  creditPolicy.resetCreditGateTelemetry();
  assert.throws(() => creditPolicy.assertLocalCanSendMessage(), /CreditPolicyError/);
  assert.equal(reported.length, 2);
});

