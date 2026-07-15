const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadCoinModule(stubs) {
  const filePath = path.join(process.cwd(), 'src/services/api/coin.ts');
  const transpiled = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
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

function baseStubs(apiClientSpy, generatedKey = 'gen-key') {
  return {
    '@/constants/config': { LIMITS: { TRANSFER_MAX_AMOUNT: 1_000_000 } },
    '@/services/api/client': { apiClient: apiClientSpy },
    '@/i18n': {
      __esModule: true,
      default: { t: (key, opts) => (opts && opts.defaultValue) || key },
    },
    '@/utils/idempotency-key': { generateIdempotencyKey: () => generatedKey },
    '@/utils/validate': {
      expectShape: (value) => value,
      isFiniteNonNegativeNumber: () => true,
      isNonEmptyString: () => true,
      isPlainObject: () => true,
    },
  };
}

test('sendCoinGift attaches an Idempotency-Key header (C-04)', async () => {
  const calls = [];
  const coin = loadCoinModule(
    baseStubs(async (endpoint, options) => {
      calls.push({ endpoint, options });
    }),
  );

  await coin.sendCoinGift({ recipientId: 'u1', amount: 10 });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].endpoint, '/coin/gift');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers['Idempotency-Key'], 'gen-key');
});

test('sendCoinGift reuses an explicitly provided idempotency key', async () => {
  const calls = [];
  const coin = loadCoinModule(
    baseStubs(async (endpoint, options) => {
      calls.push({ endpoint, options });
    }),
  );

  await coin.sendCoinGift(
    { recipientId: 'u1', amount: 10 },
    { idempotencyKey: 'explicit-key' },
  );

  assert.equal(calls[0].options.headers['Idempotency-Key'], 'explicit-key');
});

test('wallet does not expose the unsupported client-side recharge flow', () => {
  const coinSource = fs.readFileSync(
    path.join(process.cwd(), 'src/services/api/coin.ts'),
    'utf8',
  );
  const walletSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/profile/screens/WalletScreen.tsx'),
    'utf8',
  );

  assert.doesNotMatch(coinSource, /rechargePoints|\/coin\/recharge/);
  assert.doesNotMatch(walletSource, /rechargePoints|RECHARGE_PACKAGES|performRecharge/);
});
