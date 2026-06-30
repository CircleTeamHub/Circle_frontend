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
  const src = read('src/features/notes/screens/NoteLocationPickerScreen.tsx');

  assert.match(src, /react-native-webview/);
  assert.match(src, /openstreetmap\.org/);
  assert.match(src, /nominatim\.openstreetmap\.org/);
  assert.match(src, /onMessage=\{handleMapMessage\}/);
  assert.match(src, /setPickedLocation/);
  assert.match(src, /router\.back\(\)/);
});

test('note location picker store carries selected coordinates back to edit screen', () => {
  const src = read('src/features/notes/store/use-note-location-picker-store.ts');

  assert.match(src, /latitude: number/);
  assert.match(src, /longitude: number/);
  assert.match(src, /setPickedLocation/);
  assert.match(src, /consumePickedLocation/);
});
