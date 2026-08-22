const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relPath) {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('chat location entry opens a real map picker and sends the confirmed place', () => {
  const source = read('src/features/chat/screens/ChatDetailScreen.tsx');

  assert.match(source, /\(chat\)\/location-picker/);
  assert.match(source, /useChatLocationPickerStore/);
  assert.match(source, /consumePickedLocation/);
  assert.match(source, /title:\s*picked\.title/);
  assert.match(source, /address:\s*picked\.address/);
  assert.doesNotMatch(source, /case 'location':[\s\S]{0,100}handleSendCurrentLocation/);
});

test('chat exposes a full-screen OpenStreetMap picker route', () => {
  const route = read('app/(chat)/location-picker.tsx');
  const screen = read('src/features/chat/screens/ChatLocationPickerScreen.tsx');
  const sharedMap = read('src/features/location/components/map-location-picker-screen.tsx');
  const nativeSurface = read(
    'src/features/location/components/map-surface.tsx',
  );

  assert.match(route, /ChatLocationPickerScreen/);
  assert.match(screen, /MapLocationPickerScreen/);
  // 底图用 CARTO；地理编码仅走显式配置的自建/商用兼容服务。
  assert.match(sharedMap, /getBasemapUrlTemplate/);
  assert.match(sharedMap, /EXPO_PUBLIC_GEOCODER_BASE_URL/);
  assert.match(sharedMap, /requestGeocoder\('\/search'/);
  assert.doesNotMatch(sharedMap, /https:\/\/nominatim\.openstreetmap\.org/);
  assert.match(sharedMap, /location-changed/);
  assert.doesNotMatch(sharedMap, /location-selected/);
  assert.doesNotMatch(sharedMap, /unpkg\.com|<script src=|<link rel="stylesheet" href="https:/);
  assert.match(sharedMap, /LEAFLET_1_9_4_JS/);
  assert.match(sharedMap, /Content-Security-Policy/);
  assert.match(sharedMap, /MapSurface/);
  assert.match(nativeSurface, /onShouldStartLoadWithRequest/);
  assert.match(sharedMap, /setCandidateLocation/);
  assert.match(sharedMap, /onPress=\{handleConfirm\}/);
  assert.match(sharedMap, /serializeForInlineScript/);
  assert.match(sharedMap, /replaceAll\('<', '\\\\u003c'\)/);

  const leaflet = read(
    'src/features/location/components/leaflet-1.9.4.ts',
  );
  assert.match(leaflet, /Leaflet 1\.9\.4/);
  assert.match(leaflet, /export const LEAFLET_1_9_4_JS/);
  assert.match(leaflet, /export const LEAFLET_1_9_4_CSS/);
});

test('location bubbles show a real map tile and open the system map', () => {
  const bubble = read('src/features/chat/components/bubbles/location-card.tsx');

  assert.match(bubble, /getOpenStreetMapPreviewTiles/);
  assert.match(bubble, /openLocationInMaps/);
  assert.match(bubble, /locationLatitude/);
  assert.match(bubble, /locationLongitude/);
  assert.match(bubble, /<Image/);
});
