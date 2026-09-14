const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadHarness() {
  const filePath = path.join(
    process.cwd(),
    'src/features/location/services/geocoder-fetch.ts',
  );
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;
  const apiCalls = [];
  const fetchCalls = [];
  const externalResponse = {
    ok: true,
    json: async () => ({ display_name: 'San Jose' }),
  };
  const context = {
    module: { exports: {} },
    exports: {},
    URL,
    fetch: async (...args) => {
      fetchCalls.push(args);
      return externalResponse;
    },
    require: (request) => {
      if (request === '@/constants/config') {
        return { API_URL: 'https://api.example.test/api/v1' };
      }
      if (request === '@/services/api/client') {
        return {
          apiClient: async (...args) => {
            apiCalls.push(args);
            return { name: '深圳市民中心' };
          },
        };
      }
      return require(request);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(output, context, { filename: filePath });
  return { ...context.module.exports, apiCalls, fetchCalls, externalResponse };
}

test('the protected geocoder under API_URL uses apiClient', async () => {
  const { geocoderFetch, apiCalls, fetchCalls } = loadHarness();
  const response = await geocoderFetch(
    new URL(
      'https://api.example.test/api/v1/geo/reverse?lat=22.5&lon=114.0',
    ),
  );

  assert.equal(apiCalls.length, 1);
  assert.equal(apiCalls[0][0], '/geo/reverse?lat=22.5&lon=114.0');
  assert.equal(apiCalls[0][1].method, 'GET');
  assert.equal(apiCalls[0][1].headers.Accept, 'application/json');
  assert.equal(apiCalls[0][1].logResponseBody, false);
  assert.deepEqual(await response.json(), { name: '深圳市民中心' });
  assert.equal(fetchCalls.length, 0);
});

test('external Nominatim-compatible services stay anonymous', async () => {
  const { geocoderFetch, apiCalls, fetchCalls, externalResponse } = loadHarness();
  const url = new URL('https://geo.example.test/reverse?lat=1&lon=2');
  const init = { headers: { Accept: 'application/json' } };

  assert.equal(await geocoderFetch(url, init), externalResponse);
  assert.equal(apiCalls.length, 0);
  assert.deepEqual(fetchCalls, [[url, init]]);
});

test('a same-origin path outside the API base does not receive credentials', async () => {
  const { geocoderFetch, apiCalls, fetchCalls } = loadHarness();

  await geocoderFetch(new URL('https://api.example.test/api/v10/geo/reverse'));

  assert.equal(apiCalls.length, 0);
  assert.equal(fetchCalls.length, 1);
});
