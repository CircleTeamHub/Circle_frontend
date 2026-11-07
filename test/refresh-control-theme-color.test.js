const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const root = path.join(__dirname, '..', 'src');

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.tsx$/.test(entry.name) && !/\.spec\.tsx$/.test(entry.name) ? [full] : [];
  });
}

// 下拉刷新的圈统一用主题紫(底部 tab 选中的那个紫,两个主题下都是紫)。tintColor 只管 iOS,
// 安卓的圈要靠 colors 才会变色,两样都要给。
test('every pull-to-refresh spinner uses the theme purple on iOS and Android', () => {
  const controls = sources(root).flatMap((file) => {
    const src = fs.readFileSync(file, 'utf8');
    return [...src.matchAll(/<RefreshControl\b[\s\S]*?\/>/g)].map((match) => ({
      file: path.relative(path.join(__dirname, '..'), file),
      block: match[0],
    }));
  });
  assert.ok(controls.length >= 10, `expected the app's refresh controls to be scanned, found ${controls.length}`);
  for (const { file, block } of controls) {
    assert.match(block, /tintColor=\{colors\.tabBarActive\}/, `${file}: iOS spinner should use the theme purple`);
    assert.match(block, /colors=\{\[colors\.tabBarActive\]\}/, `${file}: Android spinner should use the theme purple`);
  }
});
