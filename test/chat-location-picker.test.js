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

  assert.match(route, /ChatLocationPickerScreen/);
  assert.match(screen, /MapLocationPickerScreen/);
  assert.match(sharedMap, /tile\.openstreetmap\.org/);
  assert.match(sharedMap, /nominatim\.openstreetmap\.org\/search/);
  assert.match(sharedMap, /location-selected/);
  assert.match(sharedMap, /serializeForInlineScript/);
  assert.match(sharedMap, /replaceAll\('<', '\\\\u003c'\)/);
});

test('location bubbles show a real map tile and open the system map', () => {
  const bubble = read('src/features/chat/components/bubbles/location-card.tsx');

  assert.match(bubble, /getOpenStreetMapPreviewTiles/);
  assert.match(bubble, /openLocationInMaps/);
  assert.match(bubble, /locationLatitude/);
  assert.match(bubble, /locationLongitude/);
  assert.match(bubble, /<Image/);
});
