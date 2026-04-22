const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function loadCirclesApi(deps) {
  const filePath = path.join(process.cwd(), 'src/services/api/circles.ts');
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
      if (request === '@/services/api/client') {
        return { apiClient: deps.apiClient };
      }

      if (request === '@/services/api/utils') {
        return { normalizeMediaUrl: deps.normalizeMediaUrl };
      }

      throw new Error(`Unexpected import: ${request}`);
    },
  };
  context.exports = context.module.exports;

  vm.runInNewContext(transpiled, context, { filename: filePath });
  return context.module.exports;
}

test('circle api exposes updateCircle through PATCH /circle/:id', async () => {
  const calls = [];
  const api = loadCirclesApi({
    apiClient: async (endpoint, options) => {
      calls.push({ endpoint, options });
      return {
        id: 'circle-1',
        name: 'Updated Circle',
        description: 'updated desc',
        avatarUrl: null,
        ownerID: 'owner-1',
        cities: [],
        isPublic: true,
        categories: [],
        rules: '',
        tags: [],
        joinVipRestriction: null,
        joinCreditRestriction: null,
        joinFancyRestriction: false,
        maxMembers: 500,
        memberCanPost: true,
        groupID: null,
        memberCount: 10,
        postCount: 2,
        createdAt: new Date(0).toISOString(),
        myRole: 'OWNER',
        myStatus: 'ACTIVE',
      };
    },
    normalizeMediaUrl: (value) => value,
  });

  await api.updateCircle('circle-1', {
    name: 'Updated Circle',
    memberCanPost: true,
  });

  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    {
      endpoint: '/circle/circle-1',
      options: {
        method: 'PATCH',
        body: {
          name: 'Updated Circle',
          memberCanPost: true,
        },
      },
    },
  ]);
});

test('circle detail screen routes owners and admins to the edit circle screen', () => {
  const source = read('src/features/discover/screens/CircleDetailScreen.tsx');

  assert.match(
    source,
    /pathname: '\/\(tabs\)\/discover\/circle\/\[id\]\/edit'/,
  );
  assert.doesNotMatch(source, /editInProgress/);
});

test('circle detail screen renders read-only rule summaries instead of a settings-style menu block', () => {
  const source = read('src/features/discover/screens/CircleDetailScreen.tsx');
  const zhLocale = read('src/i18n/locales/zh.json');
  const enLocale = read('src/i18n/locales/en.json');

  assert.match(source, /t\('circle\.rulesSummary'\)/);
  assert.doesNotMatch(source, /t\('circle\.settings'\)/);
  assert.doesNotMatch(source, /<MenuRow/);

  assert.match(zhLocale, /"rulesSummary":\s*"入圈规则"/);
  assert.match(enLocale, /"rulesSummary":\s*"Membership Rules"/);
});

test('discover exposes a dedicated edit circle route and screen', () => {
  const routeSource = read('app/(tabs)/discover/circle/[id]/edit.tsx');
  const screenSource = read('src/features/discover/screens/EditCircleScreen.tsx');

  assert.match(routeSource, /EditCircleScreen/);
  assert.match(screenSource, /fetchCircleDetail/);
  assert.match(screenSource, /updateCircle/);
  assert.match(screenSource, /router\.back\(\)/);
});
