const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadUtils() {
  const filePath = path.join(
    process.cwd(),
    'src/features/location/utils/location-map.ts',
  );
  assert.ok(fs.existsSync(filePath), 'location map utility must exist');
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;
  const context = { module: { exports: {} }, exports: {} };
  context.exports = context.module.exports;
  vm.runInNewContext(output, context);
  return context.module.exports;
}

test('the basemap preview uses a valid tile for the selected coordinates', () => {
  const { getOpenStreetMapTileUrl } = loadUtils();
  const url = getOpenStreetMapTileUrl(22.4806, 113.9464, 15);

  // OSM 数据 + CARTO 的底图向渲染；@2x 是因为气泡按 256 CSS px 摆瓦片。
  assert.match(
    url,
    /^https:\/\/basemaps\.cartocdn\.com\/rastertiles\/voyager\/15\/\d+\/\d+@2x\.png$/,
  );
});

test('the dark scheme swaps in the dark basemap style', () => {
  const { getOpenStreetMapTileUrl, getBasemapUrlTemplate } = loadUtils();

  assert.match(
    getOpenStreetMapTileUrl(22.4806, 113.9464, 15, { scheme: 'dark' }),
    /^https:\/\/basemaps\.cartocdn\.com\/dark_all\/15\/\d+\/\d+@2x\.png$/,
  );
  // 非高分屏不该白白多下 4 倍字节。
  assert.match(
    getOpenStreetMapTileUrl(22.4806, 113.9464, 15, { retina: false }),
    /^https:\/\/basemaps\.cartocdn\.com\/rastertiles\/voyager\/15\/\d+\/\d+\.png$/,
  );
  // Leaflet 模板把 {r} 留给调用方按 devicePixelRatio 自己填。
  assert.equal(
    getBasemapUrlTemplate('light'),
    'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
  );
  assert.equal(
    getBasemapUrlTemplate('dark'),
    'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  );
});

test('invalid coordinates never produce a remote map request', () => {
  const { getOpenStreetMapTileUrl } = loadUtils();

  assert.equal(getOpenStreetMapTileUrl(91, 113), null);
  assert.equal(getOpenStreetMapTileUrl(22, Number.NaN), null);
});

test('system map URLs carry coordinates and a safely encoded label', () => {
  const { buildSystemMapUrls } = loadUtils();
  const urls = buildSystemMapUrls(22.4806, 113.9464, '深圳湾 公园');

  assert.match(urls.ios, /^maps:\/\//);
  assert.match(urls.android, /^geo:/);
  assert.match(urls.fallback, /^https:\/\/www\.openstreetmap\.org/);
  assert.ok(urls.ios.includes(encodeURIComponent('深圳湾 公园')));
  assert.ok(urls.android.includes(encodeURIComponent('深圳湾 公园')));
});

test('map preview tiles position the selected coordinate at the card center', () => {
  const { getOpenStreetMapPreviewTiles } = loadUtils();
  const preview = getOpenStreetMapPreviewTiles(22.4806, 113.9464, 252, 124, 15);

  assert.ok(preview);
  assert.ok(preview.tiles.length >= 1 && preview.tiles.length <= 4);
  assert.equal(preview.markerLeft, 126);
  assert.equal(preview.markerTop, 62);
  for (const tile of preview.tiles) {
    assert.match(
      tile.url,
      /^https:\/\/basemaps\.cartocdn\.com\/rastertiles\/voyager\/15\/\d+\/\d+@2x\.png$/,
    );
    assert.ok(Number.isFinite(tile.left));
    assert.ok(Number.isFinite(tile.top));
  }
});

test('a bare coordinate pair is recognised as "no real address yet"', () => {
  const { isCoordinateOnlyAddress } = loadUtils();

  assert.equal(isCoordinateOnlyAddress('37.32698, -121.88435'), true);
  assert.equal(isCoordinateOnlyAddress('22.5431,114.0579'), true);
  assert.equal(isCoordinateOnlyAddress('   '), true);
  assert.equal(isCoordinateOnlyAddress(''), true);
  assert.equal(isCoordinateOnlyAddress('民田路, 福田区, 深圳市'), false);
  assert.equal(isCoordinateOnlyAddress('1 Infinite Loop, Cupertino'), false);
  assert.equal(isCoordinateOnlyAddress(undefined), false);
  assert.equal(isCoordinateOnlyAddress(null), false);
});

// GCJ-02（火星坐标）是国内地图法定的加偏坐标系。同一个点，WGS-84 和 GCJ-02 在
// 国内差 300～600 米——整整一个街区。参考值由标准 GCJ-02 算法算出。
test('WGS-84 是国内地图坐标系时会被加偏成 GCJ-02', () => {
  const { wgs84ToGcj02 } = loadUtils();

  const shenzhen = wgs84ToGcj02(22.545, 114.0575);
  assert.equal(shenzhen.latitude.toFixed(6), '22.542282');
  assert.equal(shenzhen.longitude.toFixed(6), '114.062614');

  const beijing = wgs84ToGcj02(39.9087, 116.3975);
  assert.equal(beijing.latitude.toFixed(6), '39.910103');
  assert.equal(beijing.longitude.toFixed(6), '116.403744');
});

// 加偏只在国境内成立。境外照搬公式会把坐标推歪几百米（圣何塞会被推到 6 公里外的
// 街区），所以必须有 out-of-china 闸门。
test('境外坐标原样返回，绝不加偏', () => {
  const { wgs84ToGcj02 } = loadUtils();

  const sanJose = wgs84ToGcj02(37.32698, -121.88435);
  assert.equal(sanJose.latitude, 37.32698);
  assert.equal(sanJose.longitude, -121.88435);

  const tokyo = wgs84ToGcj02(35.6812, 139.7671);
  assert.equal(tokyo.latitude, 35.6812);
  assert.equal(tokyo.longitude, 139.7671);
});

test('非法坐标不参与加偏', () => {
  const { wgs84ToGcj02 } = loadUtils();

  assert.equal(wgs84ToGcj02(91, 113), null);
  assert.equal(wgs84ToGcj02(22, Number.NaN), null);
});

// geo: 是可能被任意地图应用接管的 RFC 5870 通用 URI，缺省坐标系必须保持 WGS-84。
test('geo:、Apple Maps 与 OSM 网页版都保持 WGS-84', () => {
  const { buildSystemMapUrls } = loadUtils();
  const urls = buildSystemMapUrls(22.545, 114.0575, '深圳市民中心');

  assert.ok(urls.android.includes('22.545,114.0575'));
  assert.ok(!urls.android.includes('22.542282,114.062614'));
  // Apple Maps 收 WGS-84，中国区的偏移由它自己处理；OSM 网页版本身就是 WGS-84。
  assert.ok(urls.ios.includes('22.545,114.0575'));
  assert.ok(urls.fallback.includes('mlat=22.545'));
  assert.ok(urls.fallback.includes('mlon=114.0575'));
});

test('境外位置的 geo: 与 WGS-84 完全一致（Google Maps 才不会歪）', () => {
  const { buildSystemMapUrls } = loadUtils();
  const urls = buildSystemMapUrls(37.32698, -121.88435, 'San Jose');

  assert.ok(urls.android.includes('37.32698,-121.88435'));
});
