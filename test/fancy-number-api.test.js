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
          expectShape: (value, predicate, message) => {
            if (!predicate(value)) throw new Error(message);
            return value;
          },
          isFiniteNonNegativeNumber: (value) =>
            typeof value === 'number' && Number.isFinite(value) && value >= 0,
          isFiniteNumber: (value) =>
            typeof value === 'number' && Number.isFinite(value),
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

const listResponse = {
  items: [],
  nextCursor: null,
  unitPrice: 100,
  minMonths: 1,
  maxMonths: 12,
  purchaseMode: 'PAID_MONTHLY',
};

const purchaseResponse = {
  orderId: 'order-1',
  accountId: 'AB12C3',
  expiresAt: '2026-08-29T00:00:00.000Z',
  permanent: false,
  months: 1,
  unitPrice: 100,
  totalPrice: 100,
  walletBalanceAfter: 900,
};

test('fancy-number listing safely encodes cursor pagination', async () => {
  const calls = [];
  const api = loadFancyNumberModule(async (endpoint, options) => {
    calls.push({ endpoint, options });
    return listResponse;
  });

  await api.fetchFancyNumbers({ cursor: 'next/cursor + 1', limit: 20 });

  assert.equal(calls[0].endpoint, '/mall/fancy-numbers?cursor=next%2Fcursor+%2B+1&limit=20');
});

test('fancy-number listing rejects month ranges outside the supported 1 to 12 months', async (t) => {
  for (const [name, range] of [
    ['minimum below one', { minMonths: 0 }],
    ['minimum above twelve', { minMonths: 13, maxMonths: 13 }],
    ['maximum above twelve', { maxMonths: 13 }],
  ]) {
    await t.test(name, async () => {
      const api = loadFancyNumberModule(async () => ({
        ...listResponse,
        ...range,
      }));
      await assert.rejects(
        api.fetchFancyNumbers(),
        /服务返回了无效数据/,
      );
    });
  }
});

test('custom fancy-number availability normalizes input and safely encodes it', async () => {
  const calls = [];
  const api = loadFancyNumberModule(async (endpoint, options) => {
    calls.push({ endpoint, options });
    return { value: 'AB12C3', available: true, reason: null };
  });

  await api.checkFancyNumberAvailability(' ab12c3 ');

  assert.equal(calls[0].endpoint, '/mall/fancy-numbers/availability?value=AB12C3');
});

test('custom fancy-number availability rejects contradictory result metadata', async (t) => {
  for (const [name, response] of [
    [
      'available result with a rejection reason',
      { value: 'AB12C3', available: true, reason: 'TAKEN' },
    ],
    [
      'unavailable result without a rejection reason',
      { value: 'AB12C3', available: false, reason: null },
    ],
    [
      'result for a different requested value',
      { value: 'ZZ99Z9', available: true, reason: null },
    ],
  ]) {
    await t.test(name, async () => {
      const api = loadFancyNumberModule(async () => response);
      await assert.rejects(
        api.checkFancyNumberAvailability('AB12C3'),
        /服务返回了无效数据/,
      );
    });
  }
});

test('fancy-number mutations reject results for a different intent', async (t) => {
  const cases = [
    [
      'custom purchase returns another number',
      (api) => api.purchaseCustomFancyNumber({ value: 'AB12C3', months: 1 }),
      { ...purchaseResponse, accountId: 'ZZ99Z9' },
    ],
    [
      'paid purchase returns a permanent result',
      (api) => api.purchaseFancyNumber('number-id', { months: 1 }),
      {
        ...purchaseResponse,
        expiresAt: null,
        permanent: true,
        months: null,
        totalPrice: 0,
      },
    ],
    [
      'renewal returns a different month count',
      (api) => api.renewFancyNumber({ months: 2 }),
      { ...purchaseResponse, months: 1 },
    ],
    [
      'permanent switch returns a paid lease',
      (api) => api.switchPermanentFancyNumber('number-id'),
      purchaseResponse,
    ],
  ];

  for (const [name, invoke, response] of cases) {
    await t.test(name, async () => {
      const api = loadFancyNumberModule(async () => response);
      await assert.rejects(invoke(api), /服务返回了无效数据/);
    });
  }
});

test('fancy-number purchase, renewal, and permanent switching attach idempotency keys', async () => {
  const calls = [];
  const api = loadFancyNumberModule(async (endpoint, options) => {
    calls.push({ endpoint, options });
    if (endpoint.endsWith('/switch')) {
      return {
        ...purchaseResponse,
        accountId: endpoint.includes('/custom/') ? 'XY98Z7' : 'AB12C3',
        expiresAt: null,
        permanent: true,
        months: null,
      };
    }
    const requestedMonths = options.body.months;
    return { ...purchaseResponse, months: requestedMonths };
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

test('fancy-number API rejects malformed expiry timestamps', async () => {
  const api = loadFancyNumberModule(async () => ({
    active: true,
    accountId: 'AB12C3',
    restoreAccountId: 'USER01',
    startedAt: '2026-07-29T00:00:00.000Z',
    expiresAt: 'not-a-date',
    permanent: false,
    renewable: true,
    unitPrice: 100,
  }));

  await assert.rejects(
    api.fetchMyFancyNumber(),
    /服务返回了无效数据/,
  );
});

test('fancy-number API rejects a renewable permanent-number state', async () => {
  const api = loadFancyNumberModule(async () => ({
    active: true,
    accountId: 'AB12C3',
    restoreAccountId: 'USER01',
    startedAt: '2026-07-29T00:00:00.000Z',
    expiresAt: null,
    permanent: true,
    renewable: true,
    unitPrice: 100,
  }));

  await assert.rejects(
    api.fetchMyFancyNumber(),
    /服务返回了无效数据/,
  );
});

test('fancy-number API requires an expiry for a paid active lease', async () => {
  const api = loadFancyNumberModule(async () => ({
    ...purchaseResponse,
    expiresAt: null,
  }));

  await assert.rejects(
    api.purchaseCustomFancyNumber(
      { value: 'AB12C3', months: 1 },
      { idempotencyKey: 'paid-purchase' },
    ),
    /服务返回了无效数据/,
  );
});

test('fancy-number API accepts a null expiry only for permanent results', async () => {
  const api = loadFancyNumberModule(async () => ({
    ...purchaseResponse,
    expiresAt: null,
    permanent: true,
    months: null,
    totalPrice: 0,
  }));

  const result = await api.purchaseCustomFancyNumber(
    { value: 'AB12C3' },
    { idempotencyKey: 'permanent-purchase' },
  );

  assert.equal(result.permanent, true);
  assert.equal(result.expiresAt, null);
});
