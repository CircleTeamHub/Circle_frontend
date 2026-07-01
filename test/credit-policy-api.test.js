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

test('credit policy api posts message-send checks to the backend contract', () => {
  const source = read('src/services/api/credit-policy.ts');

  assert.match(source, /CreditPolicyAction/);
  assert.match(source, /SEND_MESSAGE/);
  assert.match(source, /LOW_CREDIT_SCORE/);
  assert.match(source, /\/credit-policy\/check/);
  assert.match(source, /method:\s*'POST'/);
});

test('assertCanSendMessage reuses a fresh allowed decision for repeated sends', async () => {
  const apiCalls = [];
  const creditPolicy = loadTsModule('src/services/api/credit-policy.ts', {
    '@/services/api/client': {
      apiClient: async (endpoint, options) => {
        apiCalls.push({ endpoint, options });
        return {
          allowed: true,
          code: null,
          currentScore: 100,
          minScore: 60,
          message: null,
        };
      },
    },
    '@/stores/authStore': {
      useAuthStore: {
        getState: () => ({
          accessToken: 'access-1',
          user: { id: 'user-1', creditScore: 100 },
        }),
      },
    },
  });

  await creditPolicy.assertCanSendMessage({
    targetType: 'GROUP',
    targetId: 'group-1',
  });
  await creditPolicy.assertCanSendMessage({
    targetType: 'GROUP',
    targetId: 'group-1',
  });

  assert.equal(apiCalls.length, 1);
  assert.equal(apiCalls[0].endpoint, '/credit-policy/check');
});

test('assertCanSendMessage blocks from local low credit without an API request', async () => {
  const apiCalls = [];
  const creditPolicy = loadTsModule('src/services/api/credit-policy.ts', {
    '@/services/api/client': {
      apiClient: async () => {
        apiCalls.push('unexpected');
        return {
          allowed: true,
          code: null,
          currentScore: 100,
          minScore: 60,
          message: null,
        };
      },
    },
    '@/stores/authStore': {
      useAuthStore: {
        getState: () => ({
          accessToken: 'access-1',
          user: { id: 'user-1', creditScore: 59 },
        }),
      },
    },
  });

  await assert.rejects(
    () =>
      creditPolicy.assertCanSendMessage({
        targetType: 'GROUP',
        targetId: 'group-1',
      }),
    (error) =>
      error?.name === 'CreditPolicyError' &&
      error?.message === '信誉值低于 60，暂时无法发送消息',
  );
  assert.equal(apiCalls.length, 0);
});

test('assertCanSendMessage lets local low credit override a cached allow decision', async () => {
  const apiCalls = [];
  const authState = {
    accessToken: 'access-1',
    user: { id: 'user-1', creditScore: 100 },
  };
  const creditPolicy = loadTsModule('src/services/api/credit-policy.ts', {
    '@/services/api/client': {
      apiClient: async (endpoint, options) => {
        apiCalls.push({ endpoint, options });
        return {
          allowed: true,
          code: null,
          currentScore: 100,
          minScore: 60,
          message: null,
        };
      },
    },
    '@/stores/authStore': {
      useAuthStore: {
        getState: () => authState,
      },
    },
  });

  await creditPolicy.assertCanSendMessage({
    targetType: 'GROUP',
    targetId: 'group-1',
  });
  authState.user.creditScore = 59;

  await assert.rejects(
    () =>
      creditPolicy.assertCanSendMessage({
        targetType: 'GROUP',
        targetId: 'group-1',
      }),
    (error) => error?.name === 'CreditPolicyError',
  );
  assert.equal(apiCalls.length, 1);
});

test('OpenIM send funnel uses only local credit state before native sendMessage', () => {
  const source = read('src/im/client.ts');
  const reportSendBlock = source.match(
    /function reportSend\([\s\S]*?\n}\n\nexport async function sendTextMessage/,
  )?.[0] ?? '';

  assert.match(source, /assertLocalCanSendMessage/);
  assert.match(reportSendBlock, /assertLocalCanSendMessage/);
  assert.doesNotMatch(reportSendBlock, /await assertCanSendMessage/);
  assert.match(reportSendBlock, /OpenIMSDK\['sendMessage'\]/);
  assert.ok(
    reportSendBlock.indexOf('assertLocalCanSendMessage') <
      reportSendBlock.indexOf("OpenIMSDK['sendMessage']"),
    'local credit state must be checked before native OpenIM sendMessage',
  );
});

test('chat detail surfaces low-credit policy errors as the send error text', () => {
  const source = read('src/features/chat/screens/ChatDetailScreen.tsx');

  assert.match(source, /CreditPolicyError/);
  assert.match(source, /getChatSendErrorMessage/);
  assert.match(source, /error instanceof CreditPolicyError/);
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
