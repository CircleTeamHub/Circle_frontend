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

test('OpenStreetMap preview uses a valid tile for the selected coordinates', () => {
  const { getOpenStreetMapTileUrl } = loadUtils();
  const url = getOpenStreetMapTileUrl(22.4806, 113.9464, 15);

  assert.match(url, /^https:\/\/tile\.openstreetmap\.org\/15\/\d+\/\d+\.png$/);
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
    assert.match(tile.url, /^https:\/\/tile\.openstreetmap\.org\/15\/\d+\/\d+\.png$/);
    assert.ok(Number.isFinite(tile.left));
    assert.ok(Number.isFinite(tile.top));
  }
});
