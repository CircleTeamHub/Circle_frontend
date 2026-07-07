const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = (path) => fs.readFileSync(path, 'utf8');

test('launch reveal plays the themed Lottie plane and Reanimated', () => {
  const source = read('src/components/app/launch-reveal.tsx');

  assert.match(source, /plane-fold\.json/);
  assert.match(source, /lottie-react-native/);
  assert.match(source, /useSharedValue/);
  assert.match(source, /useAnimatedStyle/);
  assert.match(source, /withTiming/);
  assert.match(source, /scheduleOnRN/);
});

test('root layout hides native splash before playing the launch reveal overlay', () => {
  const source = read('app/_layout.tsx');

  assert.match(source, /import\s+\{\s*LaunchReveal\s*\}/);
  assert.match(source, /nativeSplashHidden/);
  assert.match(source, /SplashScreen\.hideAsync\(\)/);
  assert.match(source, /<LaunchReveal\s+play=\{nativeSplashHidden\}/);
});
