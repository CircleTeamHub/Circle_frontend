const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadMappers() {
  const filePath = path.join(process.cwd(), 'src/chat-core/mappers.ts');
  const transpiled = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;
  const context = {
    Date,
    Number,
    module: { exports: {} },
    exports: {},
    require: (request) => {
      if (request === '@/i18n') {
        // tPreview 在 key 缺失时回落到硬编码文案,这里模拟「词条不存在」。
        return { default: { t: (key) => key } };
      }
      if (request === '@/services/api/utils') {
        return { normalizeMediaUrl: (u) => u ?? null };
      }
      if (request === '@/utils/locale') {
        return { resolveDateLocale: () => 'zh-CN', chatHistoryDateLocale: () => 'zh-CN' };
      }
      if (request === './protocol') return {};
      if (request === '@/types') return {};
      throw new Error(`unexpected require: ${request}`);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context);
  return context.module.exports;
}

function dto(over = {}) {
  return {
    id: 'm1',
    conversationId: 'c1',
    height: 1,
    type: 'text',
    content: {},
    sender: null,
    replyToId: null,
    d: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

// 文件历史页整列都靠标题区分条目。没有 file 分支的话每行都是通用的「[消息]」,
// 同一个会话里的多个文件在列表里完全无法辨认(被替换掉的 OpenIM 映射显示文件名)。
test('file messages preview as their filename', () => {
  const { getChatMessagePreview } = loadMappers();
  assert.equal(
    getChatMessagePreview({
      ...dto({ type: 'file', content: { key: 'k', fileName: '合同.pdf' } }),
    }),
    '合同.pdf',
  );
});

test('file previews fall back when the name is missing or malformed', () => {
  const { getChatMessagePreview } = loadMappers();
  for (const fileName of [undefined, null, '', '   ', 42, {}, []]) {
    const preview = getChatMessagePreview(
      dto({ type: 'file', content: { key: 'k', fileName } }),
    );
    assert.equal(typeof preview, 'string');
    assert.notEqual(preview, '');
    // 兜底必须是「文件」而不是通用的「消息」,否则跟其它类型混在一起。
    assert.match(preview, /file|文件/i);
  }
});

test('an overlong peer filename is truncated for the list row', () => {
  const { getChatMessagePreview } = loadMappers();
  const preview = getChatMessagePreview(
    dto({ type: 'file', content: { key: 'k', fileName: 'x'.repeat(500) } }),
  );
  assert.ok(preview.length <= 61, `got ${preview.length}`);
});
