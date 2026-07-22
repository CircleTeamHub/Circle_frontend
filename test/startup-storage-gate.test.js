const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// FE#87 启动时序契约：加密 MMKV 初始化必须发生在启动门内、且先于
// AsyncStorage 迁移（迁移通过 storage 壳写入，壳未就绪写入会被丢弃）；
// 语言重应用在两者之后。

function read(relPath) {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

test('root layout awaits initEncryptedStorage before migration, then reapplies language', () => {
  const source = read('app/_layout.tsx');

  const initIndex = source.indexOf('await initEncryptedStorage()');
  const migrateIndex = source.indexOf('await migrateFromAsyncStorage()');
  const rehydrateIndex = source.indexOf('rehydrateLanguageFromStorage()');

  assert.ok(initIndex >= 0, '启动门必须 await initEncryptedStorage()');
  assert.ok(migrateIndex >= 0, '启动门必须 await migrateFromAsyncStorage()');
  assert.ok(rehydrateIndex >= 0, '门后必须重应用语言偏好');
  assert.ok(
    initIndex < migrateIndex,
    '加密初始化必须先于迁移 —— 迁移写走 storage 壳，壳未就绪会丢写',
  );
  assert.ok(migrateIndex < rehydrateIndex, '语言重应用必须在迁移之后');
});

test('storage shell tolerates pre-init reads and index re-exports the initializer', () => {
  const source = read('src/storage/index.ts');

  assert.match(source, /getEncryptedInstance\(\)/);
  assert.match(source, /export \{ initEncryptedStorage \}/);
  // 壳的读回退（i18n 模块求值期会触达）
  assert.match(source, /warnNotReady\('getString', key\);\s*return undefined;/);
});
