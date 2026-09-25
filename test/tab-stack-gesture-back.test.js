const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const tabStackLayouts = [
  'app/(tabs)/messages/_layout.tsx',
  'app/(tabs)/contacts/_layout.tsx',
  'app/(tabs)/discover/_layout.tsx',
  'app/(tabs)/profile/_layout.tsx',
];

const otherBackableStackLayouts = [
  'app/(auth)/_layout.tsx',
  'app/(chat)/_layout.tsx',
  'app/(social)/_layout.tsx',
  'app/(tabs)/profile/notes/_layout.tsx',
];

test('tab child stacks keep swipe-back gestures enabled for pushed pages', () => {
  for (const layoutPath of tabStackLayouts) {
    const src = read(layoutPath);

    assert.match(
      src,
      /gestureEnabled:\s*true/,
      `${layoutPath} should allow edge swipe back on pushed screens`,
    );
    assert.match(
      src,
      /fullScreenGestureEnabled:\s*true/,
      `${layoutPath} should allow full-screen swipe back where supported`,
    );
    assert.match(
      src,
      /gestureDirection:\s*['"]horizontal['"]/,
      `${layoutPath} should keep right-swipe back gestures horizontal`,
    );
    assert.match(
      src,
      /animation:\s*['"]slide_from_right['"]/,
      `${layoutPath} should keep a horizontal push animation paired with swipe back`,
    );
  }
});

test('other backable stacks keep swipe-back gestures enabled', () => {
  for (const layoutPath of otherBackableStackLayouts) {
    const src = read(layoutPath);

    assert.match(
      src,
      /gestureEnabled:\s*true/,
      `${layoutPath} should allow edge swipe back on pushed screens`,
    );
    assert.match(
      src,
      /fullScreenGestureEnabled:\s*true/,
      `${layoutPath} should allow full-screen swipe back where supported`,
    );
    assert.match(
      src,
      /gestureDirection:\s*['"]horizontal['"]/,
      `${layoutPath} should keep right-swipe back gestures horizontal`,
    );
  }
});

test('root stack enables horizontal swipe-back gestures for nested routes', () => {
  const src = read('app/_layout.tsx');

  assert.match(src, /gestureEnabled:\s*true/);
  assert.match(src, /fullScreenGestureEnabled:\s*true/);
  assert.match(src, /gestureDirection:\s*['"]horizontal['"]/);
});
