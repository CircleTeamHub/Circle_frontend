const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const SHENZHEN = { latitude: 22.545, longitude: 114.0575 };
const BEIJING = { latitude: 39.9087, longitude: 116.3975 };
const SAN_JOSE = { latitude: 37.32698, longitude: -121.88435 };
const AMAP_KEY = 'test-amap-js-key';
const AMAP_SECURITY_CODE = 'test-security-code';

/**
 * 载入 location-map.ts。底图源要读 EXPO_PUBLIC_AMAP_*，而 Expo 是按字面量静态
 * 替换 process.env.EXPO_PUBLIC_* 的，源码里只能写成完整形式——所以这里必须把
 * process 喂进沙箱。
 */
function loadUtils(env = {}) {
  const filePath = path.join(
    process.cwd(),
    'src/features/location/utils/location-map.ts',
  );
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;
  const context = { module: { exports: {} }, exports: {}, process: { env } };
  context.exports = context.module.exports;
  vm.runInNewContext(output, context);
  return context.module.exports;
}

const withKey = () => loadUtils({ EXPO_PUBLIC_AMAP_JS_KEY: AMAP_KEY });

function readPicker() {
  return fs.readFileSync(
    path.join(
      process.cwd(),
      'src/features/location/components/map-location-picker-screen.tsx',
    ),
    'utf8',
  );
}

/** 两点间的近似米距。 */
function metersApart(a, b) {
  const latitudeMeters = (a.latitude - b.latitude) * 111320;
  const longitudeMeters =
    (a.longitude - b.longitude) * 111320 * Math.cos((a.latitude * Math.PI) / 180);
  return Math.hypot(latitudeMeters, longitudeMeters);
}

test('大陆坐标在配了高德 key 时用高德渲染', () => {
  const { getBasemapProvider } = withKey();

  assert.equal(
    getBasemapProvider(SHENZHEN.latitude, SHENZHEN.longitude),
    'amap',
  );
});

test('没配高德 key 时回落到现有底图，不至于变白图', () => {
  const { getBasemapProvider } = loadUtils({});

  assert.equal(
    getBasemapProvider(SHENZHEN.latitude, SHENZHEN.longitude),
    'carto',
  );
});

test('境外坐标始终走 CARTO —— 高德在境外基本没有数据', () => {
  const { getBasemapProvider } = withKey();

  assert.equal(
    getBasemapProvider(SAN_JOSE.latitude, SAN_JOSE.longitude),
    'carto',
  );
});

test('非法坐标不触发高德分支', () => {
  const { getBasemapProvider } = withKey();

  assert.equal(getBasemapProvider(91, 113), 'carto');
  assert.equal(getBasemapProvider(22, Number.NaN), 'carto');
});

test('高德脚本地址带上 key 与工具条插件', () => {
  const { getAmapScriptConfig } = loadUtils({
    EXPO_PUBLIC_AMAP_JS_KEY: AMAP_KEY,
    EXPO_PUBLIC_AMAP_SECURITY_CODE: AMAP_SECURITY_CODE,
  });
  const config = getAmapScriptConfig();

  assert.ok(config);
  assert.match(config.scriptUrl, /^https:\/\/webapi\.amap\.com\/maps\?/);
  assert.match(config.scriptUrl, new RegExp(`key=${AMAP_KEY}`));
  // 插件随主脚本同步加载，漏了它地图上就没有缩放控件。
  assert.match(config.scriptUrl, /plugin=AMap\.ToolBar/);
  assert.equal(config.securityCode, AMAP_SECURITY_CODE);
});

test('没配 key 时拿不到高德脚本配置', () => {
  const { getAmapScriptConfig } = loadUtils({});

  assert.equal(getAmapScriptConfig(), null);
});

test('安全密钥缺失不阻断地图，只是留空', () => {
  const { getAmapScriptConfig } = withKey();

  assert.equal(getAmapScriptConfig().securityCode, '');
});

test('GCJ-02 往返回得到原点（亚米级）', () => {
  const { wgs84ToGcj02, gcj02ToWgs84 } = loadUtils({});

  [SHENZHEN, BEIJING].forEach((point) => {
    const shifted = wgs84ToGcj02(point.latitude, point.longitude);
    const back = gcj02ToWgs84(shifted.latitude, shifted.longitude);
    // 图钉要落在同一个门牌上，1 米以内足够。
    assert.ok(metersApart(point, back) < 1);
    // 而且中间那一跳确实偏出了一个街区的量级。
    assert.ok(metersApart(point, shifted) > 300);
  });
});

test('境外与非法坐标不做减偏', () => {
  const { gcj02ToWgs84 } = loadUtils({});

  assert.deepEqual(
    { ...gcj02ToWgs84(SAN_JOSE.latitude, SAN_JOSE.longitude) },
    { latitude: SAN_JOSE.latitude, longitude: SAN_JOSE.longitude },
  );
  assert.equal(gcj02ToWgs84(91, 113), null);
});

test('选点页为两种底图各准备一套适配器，外加一个择一的入口', () => {
  const source = readPicker();

  assert.match(source, /function createLeafletAdapter\(/);
  assert.match(source, /function createAmapAdapter\(/);
  assert.match(source, /function createMapAdapter\(onPick\)/);
});

test('高德不可用时返回 null 而不是抛错，好让选点页回落到 Leaflet', () => {
  const source = readPicker();

  // key 失效、配额耗尽、脚本没下下来，高德返回的那段 JS 都不定义 AMap。
  assert.match(
    source,
    /typeof AMap === 'undefined' \|\| typeof AMap\.Map !== 'function'\) return null;/,
  );
  // 择一入口先试高德、失败落 Leaflet，两个都没有才判定地图不可用。
  assert.match(source, /createAmapAdapter\([^)]*\) \|\| /);
  assert.match(source, /if \(!adapter\) throw new Error\('no map runtime available'\)/);
});

test('Leaflet 始终内联待命，高德分支也不例外', () => {
  const source = readPicker();

  // 回落要能真的画出地图，所以库和瓦片域名都得一直备着。
  assert.match(source, /const mapLibraryTags = `\$\{amapTags\}/);
  assert.match(
    source,
    /'https:\/\/\*\.amap\.com https:\/\/\*\.autonavi\.com https:\/\/basemaps\.cartocdn\.com'/,
  );
});

test('高德分支的 CSP 放行高德域名', () => {
  const source = readPicker();

  assert.match(source, /https:\/\/webapi\.amap\.com/);
  assert.match(source, /https:\/\/\*\.autonavi\.com/);
});

test('坐标系由地图页自报，不是 React 侧预先猜的', () => {
  const source = readPicker();

  // 回落发生在脚本里，React 侧事前并不知道最终用的是哪套底图。
  assert.match(source, /const COORDINATE_SYSTEM = adapter\.coordinateSystem;/);
  assert.match(source, /coordsys: COORDINATE_SYSTEM, \.\.\.picked/);
  assert.match(source, /candidate\.coordsys === 'gcj02'\s*\?\s*gcj02ToWgs84\(/);
});

test('反查与搜索都把坐标系带给服务端，否则会被再加一次偏', () => {
  const source = readPicker();

  assert.equal(source.match(/coordsys: COORDINATE_SYSTEM/g).length, 3);
});

test('两套初始坐标一起交给地图页，脚本里不做换算', () => {
  const source = readPicker();

  assert.match(source, /const INITIAL_WGS84 = \{ latitude: \$\{latitude\}/);
  assert.match(source, /const INITIAL_GCJ02 = \{ latitude: \$\{shifted\.latitude\}/);
  assert.match(source, /wgs84ToGcj02\(\s*initialLocation\.latitude/);
});
