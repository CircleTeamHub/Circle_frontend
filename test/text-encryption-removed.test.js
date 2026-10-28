const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 文字加密已整体删除(第二阶段):加密库、本地包和所有引用都不在了。
// 老开发数据里残留的 encrypted-text 消息走未知类型的占位文案(见 chat-core-message-mappers)。

function read(relPath) {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

function exists(relPath) {
  return fs.existsSync(path.join(process.cwd(), relPath));
}

function sourceFiles(dir) {
  return fs.readdirSync(path.join(process.cwd(), dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(rel);
    return /\.(ts|tsx|mts|js)$/.test(entry.name) ? [rel] : [];
  });
}

test('the encryption library and its local package are gone', () => {
  assert.equal(exists('packages/e2ee'), false);
  assert.equal(exists('src/services/e2ee'), false);
});

test('@circle/e2ee is no longer a dependency', () => {
  const pkg = JSON.parse(read('package.json'));
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    assert.equal(Object.hasOwn(pkg[field] ?? {}, '@circle/e2ee'), false, field);
  }
  // npm 卸载本地 file: 包时会把 packages/e2ee 当 extraneous 留在锁文件里,这里一并守住。
  const lock = JSON.parse(read('package-lock.json'));
  const leftovers = Object.keys(lock.packages ?? {}).filter(
    (key) => key === 'packages/e2ee' || key === 'node_modules/@circle/e2ee',
  );
  assert.deepEqual(leftovers, []);
});

test('no app source imports the removed encryption modules', () => {
  // import / require / 动态 import / jest.mock / 类型里的 import('...') 都是同一个模块串。
  const specifier = /['"`](?:@\/services\/e2ee|@circle\/e2ee)(?:\/[^'"`]*)?['"`]/;
  const importers = [...sourceFiles('app'), ...sourceFiles('src')].filter((file) =>
    specifier.test(read(file)),
  );
  assert.deepEqual(importers, []);
});
