const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Regression guard for the DTO→domain mapping in mall.ts / membership.ts.
//
// The backend (circle_be) sends display strings under `title` / `name` / `perks`.
// The screens render t(section.titleKey) / t(product.nameKey) / t(item.perksKey).
// Before the mapper existed, fetch* cast the raw payload straight to the domain type,
// so titleKey/nameKey/perksKey were `undefined` and t(undefined) → "" → blank UI —
// but ONLY on the online path (offline used the static fallback), so it shipped green.
//
// This loads the real modules (incl. the real @/utils/validate) with a stubbed
// apiClient returning BACKEND-shaped data, and asserts the mapping fills keys and
// preserves the backend string as the t() defaultValue (passthrough for unknown ids).

const I18N_STUB = {
  __esModule: true,
  default: {
    t: (key, opts) => {
      let s = (opts && opts.defaultValue) || key;
      if (opts) {
        for (const k of Object.keys(opts)) {
          if (k !== 'defaultValue') s = s.split('{{' + k + '}}').join(String(opts[k]));
        }
      }
      return s;
    },
    language: 'zh',
  },
};

// Minimal alias-aware CommonJS loader: stubs win; '@/i18n' is stubbed; other '@/…'
// and relative TS files are transpiled and loaded for real; bare specifiers hit npm.
function makeLoader(stubs) {
  const cache = new Map();

  const resolveTs = (p) => {
    for (const cand of [p, `${p}.ts`, `${p}.tsx`, path.join(p, 'index.ts')]) {
      if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
    }
    return p;
  };

  const loadFile = (filePath) => {
    if (cache.has(filePath)) return cache.get(filePath).exports;
    const source = fs.readFileSync(filePath, 'utf8');
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
      fileName: filePath,
    }).outputText;

    const moduleObj = { exports: {} };
    cache.set(filePath, moduleObj);
    const context = {
      module: moduleObj,
      exports: moduleObj.exports,
      require: (specifier) => req(specifier, path.dirname(filePath)),
      console,
      process,
    };
    context.exports = moduleObj.exports;
    vm.runInNewContext(transpiled, context, { filename: filePath });
    return moduleObj.exports;
  };

  const req = (specifier, fromDir) => {
    if (specifier in stubs) return stubs[specifier];
    if (specifier === '@/i18n') return I18N_STUB;
    if (specifier.startsWith('@/')) {
      return loadFile(resolveTs(path.join(process.cwd(), 'src', specifier.slice(2))));
    }
    if (specifier.startsWith('.')) {
      return loadFile(resolveTs(path.resolve(fromDir, specifier)));
    }
    return require(specifier);
  };

  return (relPath) => loadFile(path.join(process.cwd(), relPath));
}

const loadWithApi = (relPath, apiResponse) =>
  makeLoader({
    '@/services/api/client': { apiClient: async () => apiResponse },
  })(relPath);

test('fetchMallSections maps backend title/name → i18n key + keeps backend string as default', async () => {
  const backend = [
    {
      id: 'cards',
      title: '我的卡券',
      products: [
        { id: 'fancy-number-card', name: '靓号卡', icon: 'sparkles-outline', color: '#2563EB', action: 'fancy-number' },
      ],
    },
    {
      // Unknown id the client catalog has never heard of — must NOT blank out.
      id: 'brand-new-section',
      title: '新专区',
      products: [{ id: 'brand-new-item', name: '新商品', icon: 'gift-outline', color: '#000', action: 'wallet' }],
    },
  ];
  const { fetchMallSections } = loadWithApi('src/services/api/mall.ts', backend);
  const sections = await fetchMallSections();

  // Known id → local key, backend string preserved as the t() default.
  assert.equal(sections[0].titleKey, 'profile.mall.sections.coupons');
  assert.equal(sections[0].defaultTitle, '我的卡券');
  assert.equal(sections[0].products[0].nameKey, 'profile.mall.items.fancyNumberCard');
  assert.equal(sections[0].products[0].defaultName, '靓号卡');

  // Unknown id → empty key (t('', {defaultValue}) still renders), backend string passes through.
  assert.equal(sections[1].titleKey, '');
  assert.equal(sections[1].defaultTitle, '新专区');
  assert.equal(sections[1].products[0].nameKey, '');
  assert.equal(sections[1].products[0].defaultName, '新商品');
});

test('fetchMallSections rejects malformed payloads instead of returning blanks', async () => {
  const { fetchMallSections } = loadWithApi('src/services/api/mall.ts', [{ id: 'x' }]);
  await assert.rejects(fetchMallSections());
});

test('FALLBACK_SECTIONS carry both a key and a non-empty default for every entry', () => {
  const { FALLBACK_SECTIONS } = loadWithApi('src/services/api/mall.ts', []);
  for (const section of FALLBACK_SECTIONS) {
    assert.ok(section.titleKey, `section ${section.id} missing titleKey`);
    assert.ok(section.defaultTitle, `section ${section.id} missing defaultTitle`);
    for (const product of section.products) {
      assert.ok(product.nameKey, `product ${product.id} missing nameKey`);
      assert.ok(product.defaultName, `product ${product.id} missing defaultName`);
    }
  }
});

test('fetchMembershipPlans maps backend perks → i18n key + keeps backend string as default', async () => {
  const backend = [
    { level: 1, name: 'VIP1', price: 780, perks: '后端权益一' },
    { level: 9, name: 'VIP9', price: 99999, perks: '未知等级权益' },
  ];
  const { fetchMembershipPlans } = loadWithApi('src/services/api/membership.ts', backend);
  const plans = await fetchMembershipPlans();

  assert.equal(plans[0].perksKey, 'profile.membership.tiers.vip1.perks');
  assert.equal(plans[0].defaultPerks, '后端权益一');

  // Unknown level → empty key, backend string passes through (no blank).
  assert.equal(plans[1].perksKey, '');
  assert.equal(plans[1].defaultPerks, '未知等级权益');
});

test('fetchMembershipPlans rejects malformed payloads', async () => {
  const { fetchMembershipPlans } = loadWithApi('src/services/api/membership.ts', [
    { level: 1, name: 'VIP1' },
  ]);
  await assert.rejects(fetchMembershipPlans());
});

test('FALLBACK_MEMBERSHIP_PLANS carry key + non-empty default for every tier', () => {
  const { FALLBACK_MEMBERSHIP_PLANS } = loadWithApi('src/services/api/membership.ts', []);
  assert.equal(FALLBACK_MEMBERSHIP_PLANS.length, 5);
  for (const plan of FALLBACK_MEMBERSHIP_PLANS) {
    assert.ok(plan.perksKey, `VIP${plan.level} missing perksKey`);
    assert.ok(plan.defaultPerks, `VIP${plan.level} missing defaultPerks`);
  }
});
