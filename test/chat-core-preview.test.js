const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const __localDbStub = {
  persistLocalConversations: async () => {},
  upsertLocalConversation: async () => {},
  removeLocalConversation: async () => {},
  persistLocalMessages: async () => {},
  deleteLocalMessage: async () => {},
  clearLocalConversationMessages: async () => {},
  deleteLocalMessagesBelow: async () => {},
  readRecentLocalMessages: async () => [],
  readLocalConversations: async () => [],
  searchLocalChatMessages: async () => [],
  outboxUpsert: async () => {},
  outboxDelete: async () => {},
  outboxList: async () => [],
  pendingReadUpsert: async () => {},
  pendingReadDelete: async () => {},
  pendingReadsList: async () => [],
  initChatLocalDb: async () => false,
  wipeChatLocalDb: async () => {},
};


function loadMappers({ withRealLocale = false } = {}) {
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
        if (!withRealLocale) {
          // tPreview 在 key 缺失时回落到硬编码文案,这里模拟「词条不存在」。
          return { default: { t: (key) => key } };
        }
        // 真词条 + i18next 的插值语义:只替换传进来的变量,没传的原样留下
        // `{{x}}`(这正是「[笔记] {{title}}」漏到列表上的机制)。
        const zh = JSON.parse(
          fs.readFileSync(
            path.join(process.cwd(), 'src/i18n/locales/zh.json'),
            'utf8',
          ),
        );
        const lookup = (key) =>
          key.split('.').reduce((node, part) => node?.[part], zh);
        return {
          default: {
            t: (key, params) => {
              const raw = lookup(key);
              if (typeof raw !== 'string') return key;
              if (!params) return raw;
              return Object.entries(params).reduce(
                (acc, [name, value]) =>
                  acc.split(`{{${name}}}`).join(String(value)),
                raw,
              );
            },
            language: 'zh',
          },
        };
      }
      if (request === '@/services/api/utils') {
        return { normalizeMediaUrl: (u) => u ?? null };
      }
      if (request === '@/utils/locale') {
        return { resolveDateLocale: () => 'zh-CN', chatHistoryDateLocale: () => 'zh-CN' };
      }
      if (request === './protocol') return {};
      if (request === '@/types') return {};
      if (request === './local-db') return __localDbStub;
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

test('卡片预览不能把 {{占位符}} 漏到列表上', () => {
  // 真词条是「[笔记] {{title}}」这种带插值的。mapper 只传了 key 不传值时,
  // i18next 会把 `{{title}}` 原样留下 —— 列表里就显示成「[笔记] {{title}}」。
  const { getChatMessagePreview } = loadMappers({ withRealLocale: true });

  const cases = [
    { type: 'note-card', content: { title: '我的笔记' }, expect: '我的笔记' },
    { type: 'friend-card', content: { nickname: '小王' }, expect: '小王' },
    { type: 'circle-card', content: { name: '摄影圈' }, expect: '摄影圈' },
    {
      type: 'verification-card',
      content: { applicantName: '老李', circleName: '摄影圈' },
      expect: '老李',
    },
    { type: 'plaza-post-card', content: { title: '周末爬山' }, expect: '周末爬山' },
  ];

  for (const { type, content, expect } of cases) {
    const preview = getChatMessagePreview(dto({ type, content }));
    assert.ok(!preview.includes('{{'), `${type} 漏了占位符: ${preview}`);
    assert.match(preview, new RegExp(expect));
  }
});

test('卡片没带标题/名字时退回纯标签,不留空占位', () => {
  const { getChatMessagePreview } = loadMappers({ withRealLocale: true });

  for (const type of [
    'note-card',
    'friend-card',
    'circle-card',
    'verification-card',
    'plaza-post-card',
  ]) {
    for (const content of [{}, { title: '   ' }, { title: 42 }]) {
      const preview = getChatMessagePreview(dto({ type, content }));
      assert.ok(!preview.includes('{{'), `${type} 漏了占位符: ${preview}`);
      assert.equal(preview, preview.trim());
      assert.notEqual(preview, '');
    }
  }
});

test('超长标题在列表里被截断', () => {
  const { getChatMessagePreview } = loadMappers({ withRealLocale: true });
  const preview = getChatMessagePreview(
    dto({ type: 'note-card', content: { title: 'x'.repeat(500) } }),
  );
  assert.ok(preview.length <= 70, `got ${preview.length}`);
});
