const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadFancyNumberModule(apiClientSpy, generatedKey = 'generated-key') {
  const filePath = path.join(process.cwd(), 'src/services/api/fancy-number.ts');
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
    URLSearchParams,
    require: (specifier) => {
      const stubs = {
        '@/services/api/client': { apiClient: apiClientSpy },
        '@/i18n': {
          __esModule: true,
          default: { t: (key, options) => options?.defaultValue ?? key },
        },
        '@/utils/idempotency-key': {
          generateIdempotencyKey: () => generatedKey,
        },
        '@/utils/validate': {
          expectShape: (value) => value,
          isFiniteNonNegativeNumber: () => true,
          isFiniteNumber: () => true,
          isNonEmptyString: () => true,
          isPlainObject: () => true,
        },
      };
      return specifier in stubs ? stubs[specifier] : require(specifier);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

test('fancy-number listing safely encodes cursor pagination', async () => {
  const calls = [];
  const api = loadFancyNumberModule(async (endpoint, options) => {
    calls.push({ endpoint, options });
    return {};
  });

  await api.fetchFancyNumbers({ cursor: 'next/cursor + 1', limit: 20 });

  assert.equal(calls[0].endpoint, '/mall/fancy-numbers?cursor=next%2Fcursor+%2B+1&limit=20');
});

test('custom fancy-number availability normalizes input and safely encodes it', async () => {
  const calls = [];
  const api = loadFancyNumberModule(async (endpoint, options) => {
    calls.push({ endpoint, options });
    return {};
  });

  await api.checkFancyNumberAvailability(' ab12c3 ');

  assert.equal(calls[0].endpoint, '/mall/fancy-numbers/availability?value=AB12C3');
});

test('fancy-number purchase, renewal, and permanent switching attach idempotency keys', async () => {
  const calls = [];
  const api = loadFancyNumberModule(async (endpoint, options) => {
    calls.push({ endpoint, options });
    return {};
  });

  await api.purchaseFancyNumber('number-id', { months: 3 });
  await api.renewFancyNumber({ months: 2 }, { idempotencyKey: 'retry-same-request' });
  await api.switchPermanentFancyNumber('replacement-id', {
    idempotencyKey: 'switch-same-request',
  });
  await api.purchaseCustomFancyNumber(
    { value: 'AB12C3', months: 1 },
    { idempotencyKey: 'custom-purchase' },
  );
  await api.switchPermanentToCustomFancyNumber(
    { value: 'XY98Z7' },
    { idempotencyKey: 'custom-switch' },
  );

  assert.equal(calls[0].endpoint, '/mall/fancy-numbers/number-id/purchase');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.body.months, 3);
  assert.equal(calls[0].options.headers['Idempotency-Key'], 'generated-key');
  assert.equal(calls[1].endpoint, '/mall/fancy-numbers/renew');
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[1].options.body.months, 2);
  assert.equal(calls[1].options.headers['Idempotency-Key'], 'retry-same-request');
  assert.equal(calls[2].endpoint, '/mall/fancy-numbers/replacement-id/switch');
  assert.equal(calls[2].options.method, 'POST');
  assert.equal(calls[2].options.headers['Idempotency-Key'], 'switch-same-request');
  assert.equal(calls[3].endpoint, '/mall/fancy-numbers/custom/purchase');
  assert.equal(calls[3].options.body.value, 'AB12C3');
  assert.equal(calls[4].endpoint, '/mall/fancy-numbers/custom/switch');
  assert.equal(calls[4].options.body.value, 'XY98Z7');
});
