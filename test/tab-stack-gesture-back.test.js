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
