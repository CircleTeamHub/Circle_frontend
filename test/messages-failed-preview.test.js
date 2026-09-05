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

/** 已确认消息:height 由服务端在 advisory lock 下递增发号。 */
const sent = (height, createdAt = '2026-08-11T01:00:00.000Z') => ({
  id: `m-${height}`,
  createdAt,
  height,
});

/**
 * 失败气泡:height 恒为 0,failedAfterHeight 是点击发送时会话里的最大 height
 * —— 也就是「这次失败之前,服务端已经确认到第几条」。
 */
const failed = (afterHeight, createdAt = '2026-08-11T01:00:00.000Z') => ({
  id: `local-${afterHeight}`,
  createdAt,
  height: 0,
  failed: true,
  failedAfterHeight: afterHeight,
});

test('最新一条发失败 → 预览要提示', () => {
  const { hasFailedLatestMessage } = loadUtil();
  // 确认到 height=7,之后那次发送失败了,再没有新的确认消息。
  assert.equal(hasFailedLatestMessage([sent(7), failed(7)]), true);
});

test('老消息失败、之后又发成功过 → 不提示', () => {
  const { hasFailedLatestMessage } = loadUtil();
  // 用户实测踩到的形状:那张转账卡在 height=7 之后没发出去,随后两条都发成功
  // (8/9),列表却把前缀贴到最新那条上,显示成「[发送失败] J」。
  assert.equal(
    hasFailedLatestMessage([sent(7), failed(7), sent(8), sent(9)]),
    false,
  );
});

test('失败气泡排在时间线最后也不算最新 —— 不按位置判', () => {
  const { hasFailedLatestMessage } = loadUtil();
  // height=0 让失败气泡在排序上恒定落在最后,按位置判会永远为真。
  assert.equal(hasFailedLatestMessage([sent(9), failed(7)]), false);
});

test('设备时钟快于服务端时,失败气泡也不会一直霸占「最新」', () => {
  const { hasFailedLatestMessage } = loadUtil();
  // 回归 codex review:失败气泡的 createdAt 来自设备时钟,已确认消息带的是
  // 服务端时间。设备快 10 分钟时,按时间戳比较会让这条失败消息在之后 10 分钟里
  // 恒为「最新」—— 期间发成功的消息全被它压住,前缀撤不掉。
  assert.equal(
    hasFailedLatestMessage([
      failed(7, '2026-08-11T01:52:00.000Z'), // 设备时钟(快 10 分钟)
      sent(8, '2026-08-11T01:43:00.000Z'), // 服务端时钟,真实上更晚
    ]),
    false,
  );
});

test('会话里只有失败气泡(还没有任何已确认消息)→ 提示', () => {
  const { hasFailedLatestMessage } = loadUtil();
  assert.equal(hasFailedLatestMessage([failed(0)]), true);
});

test('多条失败:只要有一条在最新确认之后失败就提示', () => {
  const { hasFailedLatestMessage } = loadUtil();
  assert.equal(
    hasFailedLatestMessage([failed(3), sent(8), failed(8)]),
    true,
  );
  assert.equal(hasFailedLatestMessage([failed(3), failed(5), sent(8)]), false);
});

test('空会话与残缺字段不炸', () => {
  const { hasFailedLatestMessage } = loadUtil();
  assert.equal(hasFailedLatestMessage([]), false);
  assert.equal(hasFailedLatestMessage(undefined), false);
  // height / failedAfterHeight 缺失或非数字时按 0 处理,不抛。
  assert.equal(hasFailedLatestMessage([{ id: 'x', failed: true }]), true);
  assert.equal(
    hasFailedLatestMessage([{ id: 'x', height: 'nope', failed: true }, sent(4)]),
    false,
  );
});
