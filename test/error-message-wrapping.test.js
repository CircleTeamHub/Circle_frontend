const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relPath) {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8');
}

const LOCALES = ['zh', 'en', 'ja', 'ko', 'es'];

// 「会话加载失败：websocket error」—— socket.io 的底层错误文本(websocket error /
// timeout / xhr poll error)不是给人看的。连接失败原因进 console/Sentry,store 里
// 只留规范化标记,UI 显示不带插值的友好文案。
test('socket connect errors never put the raw transport message into the store', () => {
  const src = read('src/chat-core/socket-manager.ts');

  assert.doesNotMatch(src, /setError\(err/);
  assert.match(src, /setError\('connect_error'\)/);
});

test('the conversations screen shows a friendly load-failed line, not the raw error', () => {
  const screen = read('src/features/messages/screens/MessagesScreen.tsx');

  assert.doesNotMatch(screen, /loadFailed',\s*\{\s*error/);
  assert.match(screen, /t\('messages\.loadFailed'\)/);
});

test('messages.loadFailed no longer interpolates a raw error in any locale', () => {
  for (const lng of LOCALES) {
    const dict = JSON.parse(read(`src/i18n/locales/${lng}.json`));
    const value = dict.messages && dict.messages.loadFailed;
    assert.ok(
      typeof value === 'string' && value.length > 0,
      `${lng}.json messages.loadFailed missing`,
    );
    assert.ok(
      !value.includes('{{error}}'),
      `${lng}.json messages.loadFailed still interpolates {{error}}`,
    );
  }
});

// getApiErrorMessage 是 API 错误 → 用户文案的唯一漏斗。裸 Error.message
// ("Failed to fetch"、TypeError 文本、服务端内部消息)一律不许透出;可透出的只有:
// 已映射的 serverErrors 码、客户端自造的本地化文案(status 0)、显式标记为
// 用户可见的 UserFacingError(含 StorageUploadError 既有先例)。
test('getApiErrorMessage never falls back to raw Error.message', () => {
  const src = read('src/services/api/errors.ts');

  assert.doesNotMatch(src, /instanceof Error &&\s*error\.message\)\s*\{\s*return error\.message/);
  assert.match(src, /UserFacingError/);
  assert.match(src, /status === 0/);
});

test('deliberate user-facing throws are marked as UserFacingError', () => {
  const cls = read('src/utils/user-facing-error.ts');
  assert.match(cls, /class UserFacingError extends Error/);

  const auth = read('src/services/api/auth.ts');
  assert.match(auth, /new UserFacingError\("认证返回数据格式异常/);

  const profile = read('src/services/api/profile.ts');
  assert.match(profile, /new UserFacingError\('资料已提交/);
});

// 全仓 UI 层扫描:src/features 下不许再出现「三元取裸 error.message」的形态,
// 这就是这批泄漏的统一指纹。展示走 getApiErrorMessage / getChatSendErrorMessage,
// 埋点走 diagnosticErrorMessage。report-failure 是纯上报通道,豁免。
test('no feature code extracts raw error.message for display', () => {
  const allow = new Set([
    path.normalize('src/features/notifications/utils/report-failure.ts'),
  ]);
  const root = path.join(process.cwd(), 'src', 'features');
  const offenders = [];

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name) || /\.spec\./.test(entry.name)) continue;
      const rel = path.relative(process.cwd(), abs).split(path.sep).join('/');
      if (allow.has(rel)) continue;
      const src = fs.readFileSync(abs, 'utf8');
      if (/instanceof Error\s*\?\s*\w+\.message/.test(src)) {
        offenders.push(rel);
      }
    }
  };
  walk(root);

  assert.deepEqual(
    offenders,
    [],
    `raw error.message reaches users in:\n  ${offenders.join('\n  ')}`,
  );
});

// 埋点仍然要原始错误文本,但必须走统一 helper,别在业务代码里手写三元 ——
// 手写的下一步往往就是顺手塞进 Alert。
test('client diagnostics expose a helper for raw error detail', () => {
  const src = read('src/utils/client-diagnostics.ts');
  assert.match(src, /export function diagnosticErrorMessage/);
});
