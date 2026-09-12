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

test('选点页为两种底图各准备一套运行时，接口一致', () => {
  const source = readPicker();

  // 两个分支都必须导出同名工厂，否则共享的选点逻辑会挑不到实现。
  assert.equal(source.match(/function createMapAdapter\(/g).length, 2);
  assert.match(source, /buildAmapRuntimeScript/);
  assert.match(source, /buildLeafletRuntimeScript/);
});

test('高德分支的 CSP 放行高德域名，Leaflet 分支不放行', () => {
  const source = readPicker();

  assert.match(source, /https:\/\/webapi\.amap\.com/);
  assert.match(source, /https:\/\/\*\.autonavi\.com/);
  // 未走高德时仍然只放行原来的瓦片域名。
  assert.match(source, /'https:\/\/basemaps\.cartocdn\.com'/);
});

test('高德分支全程说 GCJ-02，并把坐标系一路带给服务端', () => {
  const source = readPicker();

  assert.match(source, /isAmap \? 'gcj02' : 'wgs84'/);
  // 反查与搜索都要带上坐标系，否则服务端会按 WGS-84 再加一次偏。
  assert.equal(source.match(/coordsys: COORDINATE_SYSTEM/g).length, 2);
});

test('地图页回传的坐标在进入 App 之前被减偏回 WGS-84', () => {
  const source = readPicker();

  assert.match(source, /coordinateSystem === 'gcj02'\s*\?\s*gcj02ToWgs84\(/);
  // 初始中心点则是反过来：进地图页之前先加偏。
  assert.match(source, /wgs84ToGcj02\(initialLocation\.latitude/);
});
