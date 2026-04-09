const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadCityOptions() {
  const filePath = path.join(
    process.cwd(),
    'src/features/profile/city-options.ts',
  );
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
    require,
  };
  context.exports = context.module.exports;

  vm.runInNewContext(transpiled, context, { filename: filePath });

  return context.module.exports;
}

test('city options are grouped by province-level divisions instead of broad regions', () => {
  const { CITY_PROVINCES, findProvinceByCity } = loadCityOptions();
  const names = CITY_PROVINCES.map((item) => item.name);

  assert.equal(CITY_PROVINCES.length, 31);
  assert.equal(names.includes('华东'), false);
  assert.equal(names.includes('华南'), false);
  assert.equal(names.includes('北京'), true);
  assert.equal(names.includes('广东'), true);
  assert.equal(names.includes('新疆'), true);
  const province = findProvinceByCity('杭州');

  assert.equal(province.name, '浙江');
  assert.equal(province.cities.includes('杭州'), true);
});
