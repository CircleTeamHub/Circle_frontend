const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 文字加密停用(第一阶段):不再能开启、不再发密文、已有的加密消息只显示占位文案。
// 加密库(packages/e2ee、src/services/e2ee)第二阶段才删 —— 这一阶段它只剩一个用处:
// 删除 / 清空 / 焚毁时,把本机以前解密存下的正文一起清掉。

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
    return /\.(ts|tsx)$/.test(entry.name) ? [rel] : [];
  });
}

const APP_SOURCES = [...sourceFiles('app'), ...sourceFiles('src')].filter(
  (file) => !/\.(spec\.tsx|test\.mts)$/.test(file),
);
const OUTSIDE_E2EE_SERVICE = APP_SOURCES.filter(
  (file) => !file.startsWith(path.join('src', 'services', 'e2ee') + path.sep),
);

test('there is no screen or entry point to turn text encryption on', () => {
  assert.equal(exists('app/encryption.tsx'), false);
  assert.equal(exists('src/features/chat/screens/EncryptionSettingsScreen.tsx'), false);
  const linking = APP_SOURCES.filter((file) => /['"]\/encryption['"]/.test(read(file)));
  assert.deepEqual(linking, [], 'still navigating to the removed encryption screen');
});

test('sending never produces encrypted text', () => {
  const service = read('src/services/e2ee/client.ts');
  assert.doesNotMatch(service, /export\s+(async\s+)?function\s+encryptOutgoingText/);
  assert.doesNotMatch(service, /export\s+function\s+encryptionEnabled/);
  const callers = OUTSIDE_E2EE_SERVICE.filter((file) => read(file).includes('encryptOutgoingText'));
  assert.deepEqual(callers, []);
  // 开发开关也不再改变任何行为(发送、草稿)。
  const flagReaders = APP_SOURCES.filter((file) => read(file).includes('EXPO_PUBLIC_E2EE_TEXT_ENABLED'));
  assert.deepEqual(flagReaders, []);
});

test('encrypted bubbles are never decrypted', () => {
  assert.equal(exists('src/features/chat/components/EncryptedText.tsx'), false);
  const decrypting = OUTSIDE_E2EE_SERVICE.filter((file) => /\bdecryptText\b/.test(read(file)));
  assert.deepEqual(decrypting, []);
});

test('the stored-body purge listener is still registered at startup', () => {
  // 监听挂在 src/services/e2ee/client.ts 的模块顶层;原来是气泡组件顺带把它加载进来,
  // 气泡不再解密以后,得由根布局显式加载,否则删除 / 清空 / 焚毁都清不到本机正文。
  assert.match(read('app/_layout.tsx'), /^import '@\/services\/e2ee\/client';$/m);
  assert.match(read('src/services/e2ee/client.ts'), /^onEncryptedBodyPurge\(/m);
});
