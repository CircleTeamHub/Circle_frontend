const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(process.cwd(), rel));

test('messages scan menu opens a real scan route instead of the placeholder alert', () => {
  const source = read('src/features/messages/screens/MessagesScreen.tsx');
  const layout = read('app/(tabs)/messages/_layout.tsx');

  assert.match(source, /id === "scan"[\s\S]{0,140}router\.push\("\/\(tabs\)\/messages\/scan"/);
  assert.doesNotMatch(source, /该功能即将上线|敬请期待/);
  assert.match(layout, /<Stack\.Screen[\s\S]{0,80}name="scan"/);
  assert.equal(exists('app/(tabs)/messages/scan.tsx'), true);
});

test('messages scan screen uses expo-camera with QR-only scanning and permission handling', () => {
  const pkg = JSON.parse(read('package.json'));
  const app = JSON.parse(read('app.json'));
  const source = read('src/features/messages/screens/ScanScreen.tsx');

  assert.match(pkg.dependencies['expo-camera'], /^~?55\./);
  assert.match(
    app.expo.ios.infoPlist.NSCameraUsageDescription,
    /QR|二维码|scan|扫码|相机/i,
  );
  assert.match(source, /from 'expo-camera'/);
  assert.match(source, /CameraView/);
  assert.match(source, /useCameraPermissions/);
  assert.match(source, /BarcodeScanningResult/);
  assert.match(source, /barcodeScannerSettings=\{\{\s*barcodeTypes: \['qr'\]/);
  assert.match(source, /requestPermission/);
  assert.match(source, /Linking\.openSettings/);
});

test('messages scan screen routes recognized app results and copies unknown results', () => {
  const source = read('src/features/messages/screens/ScanScreen.tsx');
  const resolver = read('src/features/messages/utils/scan-result.ts');

  assert.match(source, /resolveMessageScanResult/);
  assert.match(source, /router\.replace\(action\.href\)/);
  assert.match(source, /Clipboard\.setStringAsync\(value\)/);
  assert.match(source, /handleCopyFallback\(action\.value\)/);
  assert.match(resolver, /type MessageScanAction/);
  assert.match(resolver, /circleim:/);
  assert.match(resolver, /\/\(tabs\)\/messages\/temp-chats/);
  assert.match(resolver, /type: 'copy'/);
});
