const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = (path) => fs.readFileSync(path, 'utf8');

test('root layout transitions directly from the native splash to the app', () => {
  const source = read('app/_layout.tsx');

  assert.match(source, /SplashScreen\.hideAsync\(\)/);
  assert.doesNotMatch(source, /LaunchReveal/);
  assert.doesNotMatch(source, /launchRevealDone/);
  assert.doesNotMatch(source, /appScale/);
});

test('the removed plane flyover assets are not shipped', () => {
  assert.equal(fs.existsSync('src/components/app/launch-reveal.tsx'), false);
  assert.equal(fs.existsSync('assets/lottie/plane-fold.json'), false);
});
