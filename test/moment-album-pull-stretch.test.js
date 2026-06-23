const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

test('MomentAlbumHeader stretches the cover from the top driven by scrollY', () => {
  const src = read('src/features/discover/components/moment-album-header.tsx');
  assert.match(src, /scrollY/);
  assert.match(src, /react-native-reanimated/);
  assert.match(src, /useAnimatedStyle/);
  // 从顶部往下拉伸
  assert.match(src, /transformOrigin/);
  assert.match(src, /scale/);
});

test('UserMomentsScreen drives the cover stretch with an animated scroll handler', () => {
  const src = read('src/features/discover/screens/UserMomentsScreen.tsx');
  assert.match(src, /react-native-reanimated/);
  assert.match(src, /useAnimatedScrollHandler/);
  assert.match(src, /useSharedValue/);
  assert.match(src, /Animated\.(FlatList|createAnimatedComponent)/);
  assert.match(src, /scrollEventThrottle/);
  assert.match(src, /scrollY/);
  // 拉伸时仍保留刷新
  assert.match(src, /RefreshControl/);
});
