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
  const cameraPlugin = app.expo.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-camera',
  );
  assert.equal(
    cameraPlugin[1].cameraPermission,
    app.expo.ios.infoPlist.NSCameraUsageDescription,
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
  const branding = read('src/constants/branding.ts');
  const layout = read('app/(tabs)/messages/_layout.tsx');

  assert.match(source, /resolveMessageScanResult/);
  // replace 换掉摄像头页可以防止返回时重复扫码，但目标必须留在同一个 messages
  // 栈：跳去顶层 /qr 会把栈换掉，落地页走完加好友就没有可返回的目标。
  assert.match(source, /router\.replace\(action\.href\)/);
  assert.match(resolver, /pathname: '\/\(tabs\)\/messages\/qr'/);
  assert.match(resolver, /pathname: '\/\(tabs\)\/messages\/qr-login'/);
  assert.match(layout, /<Stack\.Screen name="qr" \/>/);
  assert.match(layout, /<Stack\.Screen name="qr-login" \/>/);
  // 钉住两个路由的内容而不只是存在性。普通二维码进入落地页；已停用的
  // 登录二维码进入明确的兼容提示页，避免误走已删除的登录审批流程。
  assert.equal(exists('app/(tabs)/messages/qr.tsx'), true);
  assert.match(
    read('app/(tabs)/messages/qr.tsx'),
    /export \{ default \} from '@\/features\/qr\/screens\/QrLandingScreen'/,
  );
  assert.equal(exists('app/(tabs)/messages/qr-login.tsx'), true);
  assert.match(
    read('app/(tabs)/messages/qr-login.tsx'),
    /export \{ default \} from '@\/features\/qr\/screens\/QrLoginDeprecatedScreen'/,
  );
  assert.match(source, /Clipboard\.setStringAsync\(value\)/);
  assert.match(source, /handleCopyFallback\(action\.value\)/);
  assert.match(resolver, /type MessageScanAction/);
  assert.match(resolver, /APP_LINK_PROTOCOLS/);
  assert.match(branding, /windnoteai/);
  assert.match(branding, /circleim/);
  assert.match(resolver, /\/\(tabs\)\/messages\/temp-chats/);
  assert.match(resolver, /type: 'copy'/);
});
