const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const SHENZHEN = { latitude: 22.545, longitude: 114.0575 };
const BEIJING = { latitude: 39.9087, longitude: 116.3975 };
const SAN_JOSE = { latitude: 37.32698, longitude: -121.88435 };
const IOS_KEY = 'test-amap-ios-key';
const ANDROID_KEY = 'test-amap-android-key';

/**
 * 载入 location-map.ts。底图源要读平台独立的 EXPO_PUBLIC_AMAP_*_KEY，而 Expo
 * 是按字面量静态替换 process.env.EXPO_PUBLIC_* 的，源码里只能写成完整形式——所以这里必须把
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

const withKeys = () =>
  loadUtils({
    EXPO_PUBLIC_AMAP_IOS_KEY: IOS_KEY,
    EXPO_PUBLIC_AMAP_ANDROID_KEY: ANDROID_KEY,
  });

const read = (relative) =>
  fs.readFileSync(path.join(process.cwd(), relative), 'utf8');

const readPicker = () =>
  read('src/features/location/components/map-location-picker-screen.tsx');
const readNativeSurface = () =>
  read('src/features/location/components/amap-native-surface.tsx');

/** 两点间的近似米距。 */
function metersApart(a, b) {
  const latitudeMeters = (a.latitude - b.latitude) * 111320;
  const longitudeMeters =
    (a.longitude - b.longitude) * 111320 * Math.cos((a.latitude * Math.PI) / 180);
  return Math.hypot(latitudeMeters, longitudeMeters);
}

test('大陆坐标在原生模块可用且配了密钥时走高德', () => {
  const { getAmapNativeKey, getBasemapProvider } = withKeys();

  assert.equal(
    getBasemapProvider(
      SHENZHEN.latitude,
      SHENZHEN.longitude,
      true,
      getAmapNativeKey('android'),
    ),
    'amap-native',
  );
});

test('运行时只读取当前平台对应的高德密钥', () => {
  const { getAmapNativeKey, hasAmapNativeKey } = withKeys();

  assert.equal(getAmapNativeKey('ios'), IOS_KEY);
  assert.equal(getAmapNativeKey('android'), ANDROID_KEY);
  assert.equal(getAmapNativeKey('web'), '');
  assert.equal(hasAmapNativeKey('ios'), true);
  assert.equal(hasAmapNativeKey('web'), false);
});

test('旧的共享密钥不再被运行时接受', () => {
  const { getAmapNativeKey } = loadUtils({
    EXPO_PUBLIC_AMAP_NATIVE_KEY: 'legacy-shared-key',
  });

  assert.equal(getAmapNativeKey('ios'), '');
  assert.equal(getAmapNativeKey('android'), '');
});

test('拿不到原生模块时回落 —— 网页端和没 prebuild 的包都是这种', () => {
  const { getBasemapProvider } = withKeys();

  assert.equal(
    getBasemapProvider(SHENZHEN.latitude, SHENZHEN.longitude, false, ANDROID_KEY),
    'carto',
  );
});

test('没配密钥时回落，不至于变白图', () => {
  const { getBasemapProvider, hasAmapNativeKey } = loadUtils({});

  assert.equal(hasAmapNativeKey('android'), false);
  assert.equal(
    getBasemapProvider(SHENZHEN.latitude, SHENZHEN.longitude, true),
    'carto',
  );
});

test('境外坐标始终回落 —— 高德在境外基本没有数据', () => {
  const { getBasemapProvider } = withKeys();

  assert.equal(
    getBasemapProvider(SAN_JOSE.latitude, SAN_JOSE.longitude, true, IOS_KEY),
    'carto',
  );
});

test('非法坐标不触发原生分支', () => {
  const { getBasemapProvider } = withKeys();

  assert.equal(getBasemapProvider(91, 113, true, IOS_KEY), 'carto');
  assert.equal(getBasemapProvider(22, Number.NaN, true, IOS_KEY), 'carto');
});

test('署名随底图源走', () => {
  const { getBasemapAttribution } = loadUtils({});

  assert.match(getBasemapAttribution('amap-native'), /高德/);
  assert.match(getBasemapAttribution('carto'), /OpenStreetMap/);
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

test('原生地图包只能延迟 require，不能顶层 import', () => {
  const source = readNativeSurface();

  // Expo Go 里、或者装了依赖还没 prebuild 时没有对应原生模块，顶层 import 会把
  // 整个选点页拖崩。
  assert.doesNotMatch(source, /^import .*from 'expo-amap'/m);
  assert.match(source, /require\('expo-amap'\)/);
  assert.match(source, /catch \{\s*\n\s*return null;/);
  // React.forwardRef 的组件是对象，不是函数；不能因此把可用模块误判为缺失。
  assert.match(source, /mapViewType === 'function' \|\| mapViewType === 'object'/);
});

test('Android 原生地图在相机停止时补发区域变化事件', () => {
  const patch = read('patches/expo-amap+0.2.4.patch');

  assert.match(patch, /onCameraChangeFinish/);
  assert.match(
    patch,
    /onRegionChanged\([\s\S]*?Utils\.mapCameraPositionToRegion\(p0, mapView\.width, mapView\.height\)/,
  );
});

test('网页端有一份桩，永远不去碰原生包', () => {
  const stub = read(
    'src/features/location/components/amap-native-surface.web.tsx',
  );

  assert.match(stub, /isAmapNativeSupported = false/);
  assert.doesNotMatch(stub, /expo-amap/);
});

test('图钉钉在正中且不吃触摸 —— 它标的就是地图中心', () => {
  const source = readNativeSurface();

  assert.match(source, /onRegionChanged/);
  assert.match(source, /pointerEvents="none"/);
  // 这个库没有地图点击和图钉拖拽事件，所以别去找那两个回调。
  assert.doesNotMatch(source, /onTapMarker|draggable/);
});

test('选点页按可用性分流，两条路都在', () => {
  const source = readPicker();

  assert.match(source, /useNativeAmap \? \(\s*\n\s*<AmapNativeSurface/);
  assert.match(source, /\) : \(\s*\n\s*<MapSurface/);
  assert.match(source, /isAmapNativeSupported/);
});

test('原生地图回传的坐标先减偏再入库，初始中心点则先加偏', () => {
  const source = readPicker();

  assert.match(source, /const wgs84 = gcj02ToWgs84\(latitude, longitude\)/);
  assert.match(source, /wgs84ToGcj02\(initialLocation\.latitude/);
});

test('原生分支的地名反查也是设备优先', () => {
  const source = readPicker();

  // 漏传设备解析器不会让任何断言变红，但会把每次拖动都变成一次计费调用。
  assert.match(source, /resolvePlace\(\s*\n\s*wgs84\.latitude[\s\S]*?resolvePlaceOnDevice,/);
});

test('受保护的自家地名代理只经 App 认证层访问', () => {
  const picker = readPicker();
  const nativeSurface = read('src/features/location/components/map-surface.tsx');
  const webSurface = read('src/features/location/components/map-surface.web.tsx');
  const locationCard = read(
    'src/features/chat/components/bubbles/location-card.tsx',
  );

  // WebView/iframe 里的脚本拿不到安全存储中的 Bearer token，所以两端都必须把
  // geocoder-request 交回 App 层，再由统一请求助手决定是否附带登录态。
  assert.match(picker, /const useParentGeocoderBridge = true/);
  assert.match(nativeSurface, /handleWebGeocoderBridgeRequest/);
  assert.match(nativeSurface, /geocoderFetch/);
  assert.match(webSurface, /geocoderFetch/);
  // 位置气泡不经过地图载体，也必须显式注入同一个认证请求助手。
  assert.match(locationCard, /resolvePlace[\s\S]*?geocoderFetch/);
});
