const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * 跨仓契约钉死（#102）：会话撤销的 WebSocket 关闭帧靠
 *   code === 1008 && reason === 'Session revoked'
 * 判终态，reason 字面量在两个仓库各持一份：
 *   - 本仓：src/realtime/client.ts REVOKED_CLOSE_REASON
 *   - 后端：circle_be/src/realtime/realtime.service.ts REVOKED_CLOSE_REASON
 * 本测试把词面钉死在 'Session revoked'。若你改了这里的期望值，说明你正在改
 * 契约本身 —— 必须同时改后端字面量与后端的对应 pin 测试，否则撤销登出会
 * 静默退化成重连环（跑到 JWT 过期为止），且两边测试都是绿的。
 */
test('realtime 撤销关闭帧的 reason 字面量与后端逐字节一致 (#102)', () => {
  const client = fs.readFileSync(
    path.join(process.cwd(), 'src/realtime/client.ts'),
    'utf8',
  );

  assert.match(client, /const REVOKED_CLOSE_CODE = 1008;/);
  assert.match(client, /const REVOKED_CLOSE_REASON = 'Session revoked';/);
  // 判定必须同时校验 code 与 reason —— 单独 1008 还有其它五种含义
  assert.match(
    client,
    /code === REVOKED_CLOSE_CODE && reason === REVOKED_CLOSE_REASON/,
  );
  // 注释必须留下指向对端文件的路标
  assert.match(client, /circle_be\/src\/realtime\/realtime\.service\.ts/);
});
