const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relPath) {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

function exists(relPath) {
  return fs.existsSync(path.join(process.cwd(), relPath));
}

// react-native-webview 在 web 上只有一个"does not support this platform"的桩组件，
// 它把 onLoadEnd 一起吞掉 —— 选点页的 loading 永远退不掉，用户看到的就是一个
// 转不完的圈。web 必须走自己的地图载体。
test('map picker does not render react-native-webview on web', () => {
  const screen = read('src/features/location/components/map-location-picker-screen.tsx');

  assert.doesNotMatch(screen, /react-native-webview/);
  assert.match(screen, /MapSurface/);
});

test('web map surface renders a real iframe and clears the loading state', () => {
  assert.ok(
    exists('src/features/location/components/map-surface.web.tsx'),
    'web map surface must exist',
  );
  const web = read('src/features/location/components/map-surface.web.tsx');

  assert.match(web, /<iframe/);
  assert.match(web, /srcDoc=\{html\}/);
  assert.match(web, /onLoad=\{onLoadEnd\}/);
  assert.doesNotMatch(web, /from 'react-native-webview'/);
});

test('web map surface only trusts messages coming from its own frame', () => {
  const web = read('src/features/location/components/map-surface.web.tsx');

  // srcDoc + sandbox 是 opaque origin（event.origin === 'null'），认不了来源域名，
  // 只能比对 contentWindow；否则任意窗口都能伪造一个选点结果。
  assert.match(web, /event\.source !== requestSource/);
  assert.match(web, /sandbox="allow-scripts"/);
  assert.match(web, /typeof event\.data !== 'string'/);
});

test('web geocoder runs in the trusted parent origin instead of the opaque iframe', () => {
  const web = read('src/features/location/components/map-surface.web.tsx');
  const screen = read('src/features/location/components/map-location-picker-screen.tsx');

  assert.match(web, /type === 'geocoder-request'/);
  assert.match(web, /const requestSource = frameRef\.current\?\.contentWindow/);
  assert.match(web, /requestSource\.postMessage/);
  assert.match(web, /payload\.path !== '\/search'/);
  assert.match(web, /fetch\(url/);
  assert.match(screen, /USE_PARENT_GEOCODER_BRIDGE/);
  assert.match(web, /type: 'geocoder-response'/);
  assert.match(screen, /requestParentGeocoder\(path, params\)/);
  assert.match(screen, /geocoderBaseUrl=\{readGeocoderBaseUrl\(\)\}/);
});

test('native map surface keeps the WebView bridge', () => {
  const native = read('src/features/location/components/map-surface.tsx');

  assert.match(native, /react-native-webview/);
  assert.match(native, /event\.nativeEvent\.data/);
  assert.match(native, /baseUrl: 'https:\/\/appassets\.invalid\/'/);
  assert.match(native, /onShouldStartLoadWithRequest/);
  assert.doesNotMatch(native, /originWhitelist=\{\['\*'\]\}/);
});

test('map html posts through a bridge that works in both WebView and iframe', () => {
  const screen = read('src/features/location/components/map-location-picker-screen.tsx');

  assert.match(screen, /window\.ReactNativeWebView\s*\|\|/);
  assert.match(screen, /window\.parent\.postMessage/);
});
