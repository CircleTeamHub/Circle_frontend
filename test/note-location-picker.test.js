/* global __dirname */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('profile notes stack exposes a real map location picker route', () => {
  const route = read('app/(tabs)/profile/notes/location-picker.tsx');
  assert.match(route, /NoteLocationPickerScreen/);
});

test('NoteLocationPickerScreen renders a WebView-backed map picker', () => {
  const screen = read('src/features/notes/screens/NoteLocationPickerScreen.tsx');
  const src = read('src/features/location/components/map-location-picker-screen.tsx');
  // WebView 只剩在原生载体里；web 走 map-surface.web.tsx 的 iframe。
  const nativeSurface = read('src/features/location/components/map-surface.tsx');

  assert.match(nativeSurface, /react-native-webview/);
  assert.match(src, /getBasemapUrlTemplate/);
  assert.match(src, /EXPO_PUBLIC_GEOCODER_BASE_URL/);
  assert.doesNotMatch(src, /https:\/\/nominatim\.openstreetmap\.org/);
  assert.match(src, /onMessage=\{handleMapMessage\}/);
  assert.match(screen, /MapLocationPickerScreen/);
  assert.match(screen, /setPickedLocation/);
  assert.match(screen, /router\.back\(\)/);
});

test('NoteLocationPickerScreen keeps the real map full screen with a bottom sheet', () => {
  const src = read('src/features/location/components/map-location-picker-screen.tsx');

  assert.match(src, /\.bottomSheet/);
  assert.match(src, /safe-area-inset-bottom/);
  assert.match(src, /mapFrame:\s*\{\s*flex:\s*1/);
  assert.match(src, /margin:\s*0/);
  assert.doesNotMatch(src, /\.panel/);
  assert.doesNotMatch(src, /mapFrame:\s*\{[\s\S]*borderRadius:\s*Radius\.md/);
});

test('note location picker store carries selected coordinates back to edit screen', () => {
  const src = read('src/features/notes/store/use-note-location-picker-store.ts');
  const locationType = read('src/features/location/types.ts');

  assert.match(locationType, /latitude: number/);
  assert.match(locationType, /longitude: number/);
  assert.match(src, /PickedLocation/);
  assert.match(src, /setPickedLocation/);
  assert.match(src, /consumePickedLocation/);
});
