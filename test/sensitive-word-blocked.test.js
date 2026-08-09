const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// 服务端敏感词拦截(circle_be 发送链路进程内检查)通过字符串错误码
// CHAT_SENSITIVE_WORD_BLOCKED 透传到 chat:send ack;前端据此弹「包含敏感词」
// 而非笼统的「发送失败」。契约随自研栈迁移更新(意图不变):
// 1) chat-core 判定函数引用同一字符串码;
// 2) 与 circle_be 注册表的跨仓字符串契约(sibling checkout 时校验);
// 3) ChatDetailScreen 的错误映射与 5 语言文案接线。

test('chat-core 判定函数钉在 CHAT_SENSITIVE_WORD_BLOCKED 字符串码上', () => {
  const client = fs.readFileSync(
    path.join(process.cwd(), 'src/chat-core/client.ts'),
    'utf8',
  );
  assert.match(client, /isChatSendBlockedBySensitiveWord/);
  assert.match(client, /CHAT_SENSITIVE_WORD_BLOCKED/);
});

// 跨仓字符串契约:与 circle_be 的 ChatErrorCode 注册表保持一致。
// 仅在 circle_be 与 circle-im 并排 checkout 时运行(同 api-error-localization)。
const BACKEND_ERROR_CODES_PATH = path.join(
  process.cwd(),
  '..',
  'circle_be',
  'src/common/app-error-codes.ts',
);

test(
  '前后端敏感词错误码字符串契约一致',
  { skip: !fs.existsSync(BACKEND_ERROR_CODES_PATH) },
  () => {
    const source = fs.readFileSync(BACKEND_ERROR_CODES_PATH, 'utf8');
    assert.match(
      source,
      /CHAT_SENSITIVE_WORD_BLOCKED/,
      '后端注册表必须包含 CHAT_SENSITIVE_WORD_BLOCKED,与 chat-core 判定同名',
    );
  },
);

test('ChatDetailScreen 把敏感词拦截映射到专属文案', () => {
  const source = fs.readFileSync(
    path.join(
      process.cwd(),
      'src/features/chat/screens/ChatDetailScreen.tsx',
    ),
    'utf8',
  );
  // 自研聊天栈:判定函数换成 chat-core 的字符串码版本(73001 数字契约随
  // OpenIM 下线;isSensitiveWordBlockedError 仍在 src/im 供双轨期旧路径使用)。
  assert.match(
    source,
    /isChatSendBlockedBySensitiveWord\(error\)/,
    'getChatSendErrorMessage 必须先判敏感词拦截',
  );
  assert.match(
    source,
    /chat\.detail\.sensitiveWordBlocked/,
    '命中时必须走 chat.detail.sensitiveWordBlocked 文案',
  );
});

test('5 个语言包都有 chat.detail.sensitiveWordBlocked', () => {
  for (const locale of ['zh', 'en', 'ja', 'ko', 'es']) {
    const messages = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), `src/i18n/locales/${locale}.json`),
        'utf8',
      ),
    );
    const value = messages?.chat?.detail?.sensitiveWordBlocked;
    assert.equal(
      typeof value,
      'string',
      `${locale}.json 缺 chat.detail.sensitiveWordBlocked`,
    );
    assert.ok(value.length > 0, `${locale} 文案不能为空`);
  }
});
