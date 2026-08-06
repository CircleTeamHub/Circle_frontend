const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

// 服务端敏感词拦截（circle_be OpenIM before-send 回调）通过一个跨仓数字
// errCode 透传到 sendMessage 失败；前端据此弹「包含敏感词」而非笼统的
// 「发送失败」。本测试钉死三件事：
// 1) im/error-codes 的判定函数语义；
// 2) 与 circle_be 常量的跨仓数字契约（sibling checkout 时校验）；
// 3) ChatDetailScreen 的错误映射与 5 语言文案接线。

const errorCodes = loadTsModule('src/im/error-codes.ts');

test('OPENIM_SENSITIVE_WORD_BLOCKED_CODE 固定为 73001', () => {
  assert.equal(errorCodes.OPENIM_SENSITIVE_WORD_BLOCKED_CODE, 73001);
});

test('isSensitiveWordBlockedError 仅认 code 恰为契约值的对象错误', () => {
  const { isSensitiveWordBlockedError, OPENIM_SENSITIVE_WORD_BLOCKED_CODE } =
    errorCodes;
  const hit = new Error('blocked');
  hit.code = OPENIM_SENSITIVE_WORD_BLOCKED_CODE;
  assert.equal(isSensitiveWordBlockedError(hit), true);
  // 纯对象（SDK reject 出来的不一定是 Error 实例）也认
  assert.equal(
    isSensitiveWordBlockedError({ code: OPENIM_SENSITIVE_WORD_BLOCKED_CODE }),
    true,
  );
  assert.equal(isSensitiveWordBlockedError({ code: 500 }), false);
  assert.equal(
    isSensitiveWordBlockedError({ code: String(OPENIM_SENSITIVE_WORD_BLOCKED_CODE) }),
    false,
    '字符串 code 不应通过 —— 契约是数字',
  );
  assert.equal(isSensitiveWordBlockedError(null), false);
  assert.equal(isSensitiveWordBlockedError('blocked'), false);
  assert.equal(isSensitiveWordBlockedError(undefined), false);
});

// 跨仓数字契约：与 circle_be 的 SENSITIVE_WORD_BLOCKED_ERR_CODE 保持一致。
// 仅在 circle_be 与 circle-im 并排 checkout 时运行（同 api-error-localization）。
const BACKEND_CONSTANTS_PATH = path.join(
  process.cwd(),
  '..',
  'circle_be',
  'src/sensitive-word/sensitive-word.constants.ts',
);

test(
  '前后端敏感词 errCode 数字契约一致',
  { skip: !fs.existsSync(BACKEND_CONSTANTS_PATH) },
  () => {
    const source = fs.readFileSync(BACKEND_CONSTANTS_PATH, 'utf8');
    const match = source.match(
      /SENSITIVE_WORD_BLOCKED_ERR_CODE\s*=\s*(\d+)/,
    );
    assert.ok(match, '后端必须导出 SENSITIVE_WORD_BLOCKED_ERR_CODE 数字常量');
    assert.equal(
      Number(match[1]),
      errorCodes.OPENIM_SENSITIVE_WORD_BLOCKED_CODE,
      '前后端敏感词拦截 errCode 必须同步修改',
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
  assert.match(
    source,
    /isSensitiveWordBlockedError\(error\)/,
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
