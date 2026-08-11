const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

/** 纯函数模块(只有 type import,转译后没有运行时依赖)。 */
function loadUtil() {
  const filePath = path.join(
    process.cwd(),
    'src/features/messages/utils/failed-preview.ts',
  );
  const context = {
    Date,
    Number,
    module: { exports: {} },
    exports: {},
    require: (request) => {
      throw new Error(`unexpected require: ${request}`);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
      fileName: filePath,
    }).outputText,
    context,
  );
  return context.module.exports;
}

const msg = (createdAt, failed = false) => ({
  id: `m-${createdAt}`,
  createdAt,
  height: failed ? 0 : 1,
  ...(failed ? { failed: true } : {}),
});

test('最新一条发失败 → 预览要提示', () => {
  const { hasFailedLatestMessage } = loadUtil();
  assert.equal(
    hasFailedLatestMessage([
      msg('2026-08-11T01:00:00.000Z'),
      msg('2026-08-11T01:42:00.000Z', true),
    ]),
    true,
  );
});

test('老消息失败、之后又发成功过 → 不提示', () => {
  const { hasFailedLatestMessage } = loadUtil();
  // 用户实测踩到的形状:01:23 那张转账卡没发出去,01:42 的两条都发成功了,
  // 列表却显示「[发送失败] J」—— J 明明发出去了。
  assert.equal(
    hasFailedLatestMessage([
      msg('2026-08-11T01:23:00.000Z', true),
      msg('2026-08-11T01:42:00.000Z'),
    ]),
    false,
  );
});

test('失败气泡排在时间线最后也不算最新 —— 只比时间不比位置', () => {
  const { hasFailedLatestMessage } = loadUtil();
  // height=0 让失败气泡恒排最后,按位置判会永远为真。
  assert.equal(
    hasFailedLatestMessage([
      msg('2026-08-11T01:42:00.000Z'),
      msg('2026-08-11T01:23:00.000Z', true),
    ]),
    false,
  );
});

test('同一毫秒并列时,只要有一条失败就提示', () => {
  const { hasFailedLatestMessage } = loadUtil();
  assert.equal(
    hasFailedLatestMessage([
      msg('2026-08-11T01:42:00.000Z'),
      msg('2026-08-11T01:42:00.000Z', true),
    ]),
    true,
  );
});

test('空会话与坏时间戳不炸', () => {
  const { hasFailedLatestMessage } = loadUtil();
  assert.equal(hasFailedLatestMessage([]), false);
  assert.equal(hasFailedLatestMessage(undefined), false);
  assert.equal(
    hasFailedLatestMessage([{ id: 'x', createdAt: 'not-a-date', failed: true }]),
    false,
  );
});
