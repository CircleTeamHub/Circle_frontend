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

// 布局里一写 Stack.Screen,写出来的页面就排到最前,第一个就是进 tab 时的首屏
// (unstable_settings.initialRouteName 管不到)。只写一个选位置页的话,点 tab 打开的就是选位置页。
test('stacks that declare screens declare index first', () => {
  const root = path.join(__dirname, '..', 'app');
  const layouts = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === '_layout.tsx') layouts.push(full);
    }
  };
  walk(root);
  const checked = layouts.filter((layout) => {
    const dir = path.dirname(layout);
    // 根布局的首屏是 (tabs) 分组,不是 index。
    return dir !== root && fs.existsSync(path.join(dir, 'index.tsx'));
  });
  assert.ok(checked.length >= 6, 'expected the tab stacks and notes stack to be scanned');
  for (const layout of checked) {
    const first = fs.readFileSync(layout, 'utf8').match(/<Stack\.Screen\s+name="([^"]+)"/);
    if (!first) continue;
    const rel = path.relative(path.join(__dirname, '..'), layout);
    assert.equal(first[1], 'index', `${rel} must list index first, or the stack opens on "${first[1]}"`);
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
    assert.match(
      src,
      /animation:\s*['"]slide_from_right['"]/,
      `${layoutPath} should keep a horizontal push animation paired with swipe back`,
    );
  }
});

test('root stack enables horizontal swipe-back gestures for nested routes', () => {
  const src = read('app/_layout.tsx');

  assert.match(src, /gestureEnabled:\s*true/);
  assert.match(src, /fullScreenGestureEnabled:\s*true/);
  assert.match(src, /gestureDirection:\s*['"]horizontal['"]/);
});

test('root onboarding route stays non-dismissible', () => {
  const src = read('app/_layout.tsx');

  assert.match(
    src,
    /<Stack\.Screen\s+name="\(onboarding\)"\s+options=\{\{\s*gestureEnabled:\s*false,\s*fullScreenGestureEnabled:\s*false,\s*\}\}/s,
  );
});

test('map picker routes keep full-screen swipe-back disabled', () => {
  for (const layoutPath of [
    'app/(chat)/_layout.tsx',
    'app/(tabs)/profile/notes/_layout.tsx',
  ]) {
    const src = read(layoutPath);

    assert.match(
      src,
      /<Stack\.Screen\s+name="location-picker"\s+options=\{\{\s*fullScreenGestureEnabled:\s*false\s*\}\}/s,
      `${layoutPath} should keep map panning from dismissing the picker`,
    );
  }
  // 编辑笔记页挂在进入它的那个 tab 栈里,选位置页也在同一栈:每个栈都要关掉全屏右滑。
  for (const tab of ['messages', 'contacts', 'discover', 'explore']) {
    const layoutPath = `app/(tabs)/${tab}/_layout.tsx`;
    assert.match(
      read(layoutPath),
      /<Stack\.Screen\s+name="notes\/location-picker"\s+options=\{\{\s*fullScreenGestureEnabled:\s*false\s*\}\}/s,
      `${layoutPath} should keep map panning from dismissing the note location picker`,
    );
  }
});

test('active group calls keep full-screen swipe-back disabled', () => {
  const src = read('app/(chat)/_layout.tsx');

  assert.match(
    src,
    /<Stack\.Screen\s+name="group-call"\s+options=\{\{\s*fullScreenGestureEnabled:\s*false\s*\}\}/s,
    'group calls must not be dismissed by horizontal participant-grid drags',
  );
});
