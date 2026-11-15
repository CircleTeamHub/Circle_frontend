const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 卡顿回归(react-freeze#44):react-freeze 1.0.4 冻结时抛永不完成的 thenable,React 19.1+ 下两个冻结
// 边界会无限轮换提交,JS 线程卡 6～50 秒。patches/react-freeze+1.0.4.patch 改成 use() 挂起。
// 行为由 src/components/app/react-freeze-patch.spec.tsx 验证,但 jest 读的是 package.json 的 main
// (dist),Metro 打包读的是 react-native 字段(src/index.tsx)。这里守住三个入口都打上了补丁。
test('every react-freeze entry point suspends through use() instead of a never-resolving thenable', () => {
  const pkgDir = path.join(__dirname, '..', 'node_modules', 'react-freeze');
  const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '1.0.4', 'react-freeze changed: re-check whether the patch is still needed');

  const entries = [pkg['react-native'], pkg.main, pkg.module];
  assert.deepEqual(entries, ['src/index.tsx', 'dist/index.js', 'dist/index.modern.js']);
  for (const entry of entries) {
    const source = fs.readFileSync(path.join(pkgDir, entry), 'utf8');
    assert.doesNotMatch(source, /infiniteThenable/, `${entry} still throws the never-resolving thenable`);
    assert.match(source, /\buse\(suspension\.current\.promise\)/, `${entry} does not suspend through use()`);
  }
});
