const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadGroupExpansionModule(apiClientSpy, generatedKey = 'generated-key') {
  const filePath = path.join(process.cwd(), 'src/services/api/group-expansion.ts');
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
          expectShape: (value, predicate, message) => {
            if (!predicate(value)) throw new Error(message);
            return value;
          },
          isFiniteNonNegativeNumber: (value) =>
            typeof value === 'number' && Number.isFinite(value) && value >= 0,
          isNonEmptyString: (value) =>
            typeof value === 'string' && value.trim().length > 0,
          isPlainObject: (value) =>
            value !== null && typeof value === 'object' && !Array.isArray(value),
        },
      };
      return specifier in stubs ? stubs[specifier] : require(specifier);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

const productResponse = {
  circleId: 'circle/id + 1',
  memberCount: 42,
  currentMaxMembers: 100,
  expansionSeats: 0,
  hardLimit: 3000,
  products: [
    {
      id: 'light',
      name: '轻量扩容卡',
      seats: 100,
      price: 100,
      purchasable: true,
      unavailableReason: null,
      resultingMaxMembers: 200,
    },
  ],
};

test('group-expansion catalog safely encodes the selected circle id', async () => {
  const calls = [];
  const api = loadGroupExpansionModule(async (endpoint, options) => {
    calls.push({ endpoint, options });
    return productResponse;
  });

  const result = await api.fetchGroupExpansionProducts('circle/id + 1');

  assert.equal(
    calls[0].endpoint,
    '/group-expansions/products?circleId=circle%2Fid%20%2B%201',
  );
  assert.equal(result.products[0].price, 100);
});

test('group-expansion purchase sends the selected server product and an idempotency key', async () => {
  const calls = [];
  const response = {
    orderId: 'order-1',
    circleId: 'circle-1',
    productId: 'light',
    productName: '轻量扩容卡',
    seats: 100,
    price: 600,
    previousMaxMembers: 100,
    newMaxMembers: 200,
    walletBalanceAfter: 2400,
  };
  const api = loadGroupExpansionModule(async (endpoint, options) => {
    calls.push({ endpoint, options });
    return response;
  });

  const result = await api.purchaseGroupExpansion('circle-1', 'light', {
    idempotencyKey: 'retry-same-request',
  });

  assert.equal(calls[0].endpoint, '/group-expansions/purchases');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.body.circleId, 'circle-1');
  assert.equal(calls[0].options.body.productId, 'light');
  assert.equal(
    calls[0].options.headers['Idempotency-Key'],
    'retry-same-request',
  );
  assert.equal(result.walletBalanceAfter, 2400);
});

test('group-expansion API rejects malformed server payloads', async () => {
  const api = loadGroupExpansionModule(async () => ({
    ...productResponse,
    products: [{ ...productResponse.products[0], seats: -100 }],
  }));

  await assert.rejects(
    api.fetchGroupExpansionProducts('circle-1'),
    /服务返回了无效数据/,
  );
});
