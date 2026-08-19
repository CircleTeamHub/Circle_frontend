const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// 除了敏感词,所有 ack 拒绝都落到同一句「发送失败,请重试」—— 而被禁言、被拉黑、
// 对方不收陌生人消息这些状态,不改权限/关系/时机的话重试多少次都不会成功。
// 同时:拆栈后这条最关键的链路在 release 包里完全没有 Sentry 信号。
function loadSendErrors({ dev = false } = {}) {
  const filePath = path.join(process.cwd(), 'src/chat-core/send-errors.ts');
  const transpiled = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;

  const reports = [];
  class ChatSendError extends Error {
    constructor(code, message) {
      super(message ?? code);
      this.name = 'ChatSendError';
      this.code = code;
    }
  }
  // 真实的 CreditPolicyError 带结构化字段;message 是硬编码中文的开发者兜底,
  // 上屏必须换成按当前语言的词条 —— 这里的桩要能验证「换了没有」。
  class CreditPolicyError extends Error {
    constructor(minScore) {
      super(`信誉值低于 ${minScore}，暂时无法发送消息`);
      this.name = 'CreditPolicyError';
      this.code = 'LOW_CREDIT_SCORE';
      this.minScore = minScore;
    }
  }

  const context = {
    __DEV__: dev,
    Error,
    Set,
    module: { exports: {} },
    exports: {},
    require: (request) => {
      if (request === '@/i18n') {
        return {
          default: {
            // 真实词条的替身:只有已知 code 才有 serverErrors 文案。
            t: (key, opts) =>
              key.startsWith('serverErrors.') || key === 'chat.detail.sensitiveWordBlocked'
                ? `i18n:${key}`
                : (opts?.defaultValue ?? key),
          },
        };
      }
      if (request === '@/observability/sentry') {
        return {
          reportError: (error, ctx) => reports.push({ message: error.message, ctx }),
        };
      }
      if (request === '@/services/api/credit-policy') {
        return {
          CreditPolicyError,
          // 本地化边界的替身:返回一句可辨认的「非中文」文案。
          getCreditPolicyMessage: (d) => `credit<${d.minScore}> [localized]`,
        };
      }
      if (request === '@/services/api/server-error-codes') {
        return { isKnownServerErrorCode: (v) => v.startsWith('CHAT_') };
      }
      if (request === './socket-manager') return { ChatSendError };
      throw new Error(`unexpected require: ${request}`);
    },
  };
  context.exports = context.module.exports;
  vm.runInNewContext(transpiled, context);
  return { api: context.module.exports, reports, ChatSendError, CreditPolicyError };
}

test('permanent/actionable rejections get their own localized reason', () => {
  const { api, ChatSendError } = loadSendErrors();
  for (const code of [
    'CHAT_CONVERSATION_MUTED',
    'CHAT_BLOCKED',
    'CHAT_STRANGER_NOT_ALLOWED',
    'CHAT_RATE_LIMITED',
    'CHAT_NOT_MEMBER',
  ]) {
    assert.equal(
      api.getChatSendErrorMessage(new ChatSendError(code), 'RETRY'),
      `i18n:serverErrors.${code}`,
      code,
    );
  }
  // 敏感词保留更贴聊天场景的既有词条。
  assert.equal(
    api.getChatSendErrorMessage(new ChatSendError('CHAT_SENSITIVE_WORD_BLOCKED'), 'RETRY'),
    'i18n:chat.detail.sensitiveWordBlocked',
  );
});

test('transient and unknown failures keep the generic retry copy', () => {
  const { api, ChatSendError } = loadSendErrors();
  for (const code of [
    'CHAT_ACK_TIMEOUT',
    'CHAT_NOT_CONNECTED',
    'CHAT_INVALID_PAYLOAD',
    // 后端新加、前端还不认识的码:绝不把服务端原始 message 展示给用户。
    'CHAT_SOME_FUTURE_CODE',
  ]) {
    assert.equal(
      api.getChatSendErrorMessage(new ChatSendError(code, 'internal detail'), 'RETRY'),
      'RETRY',
      code,
    );
  }
  assert.equal(api.getChatSendErrorMessage(new Error('boom'), 'RETRY'), 'RETRY');
});

test('development builds append the structured socket ack code only', () => {
  const { api, ChatSendError } = loadSendErrors({ dev: true });
  assert.equal(
    api.getChatSendErrorMessage(
      new ChatSendError('CHAT_INVALID_PAYLOAD', 'internal detail'),
      'RETRY',
    ),
    'RETRY (CHAT_INVALID_PAYLOAD)',
  );
});

test('sanitized storage upload failures remain actionable to the user', () => {
  const { api } = loadSendErrors();
  const error = new Error('上传失败 (400: InvalidRequest)');
  error.name = 'StorageUploadError';

  assert.equal(
    api.getChatSendErrorMessage(error, 'RETRY'),
    '上传失败 (400: InvalidRequest)',
  );
  // Arbitrary errors cannot opt into displaying backend/internal text.
  assert.equal(api.getChatSendErrorMessage(new Error('private detail'), 'RETRY'), 'RETRY');
});

test('expired temp chat failures use the localized non-retry explanation', () => {
  const { api } = loadSendErrors();
  const error = new Error('internal temp chat state');
  error.name = 'TempChatUnavailableError';

  assert.equal(
    api.getChatSendErrorMessage(error, 'RETRY'),
    '该临时聊天已过期。',
  );
});

test('the credit-gate rejection is localized, not the hard-coded Chinese', () => {
  // error.message 是给日志/Sentry 的开发者兜底,硬编码中文。直接上屏的话
  // 英/西/日/韩用户被信用分拦下时看到的是一句中文。
  const { api, CreditPolicyError } = loadSendErrors();
  const shown = api.getChatSendErrorMessage(new CreditPolicyError(60), 'RETRY');
  assert.equal(shown, 'credit<60> [localized]');
  assert.notEqual(shown, new CreditPolicyError(60).message);
});

test('send failures reach production reporting without any payload data', () => {
  const { api, reports, ChatSendError } = loadSendErrors();
  api.reportChatSendFailure('image', new ChatSendError('CHAT_ACK_TIMEOUT', 'timeout'));

  assert.equal(reports.length, 1);
  assert.equal(reports[0].ctx.operation, 'chatSend');
  assert.equal(reports[0].ctx.kind, 'image');
  assert.equal(reports[0].ctx.code, 'CHAT_ACK_TIMEOUT');
  // 正文 / 投递幂等键 / 会话 id 一个都不许出现。
  const serialized = JSON.stringify(reports[0]);
  for (const forbidden of ['content', 'text', '"d"', 'conversationId']) {
    assert.ok(!serialized.includes(forbidden), `${forbidden} leaked into the report`);
  }
});

test('expected policy rejections are not reported as failures', () => {
  const { api, reports, ChatSendError } = loadSendErrors();
  for (const code of [
    'CHAT_SENSITIVE_WORD_BLOCKED',
    'CHAT_CONVERSATION_MUTED',
    'CHAT_BLOCKED',
    'CHAT_RATE_LIMITED',
  ]) {
    api.reportChatSendFailure('text', new ChatSendError(code));
  }
  // 预期内的拒绝报上去只有噪音,还会把配额挤掉(与 4xx 不上报同一条线)。
  assert.equal(reports.length, 0);
});

test('a persistent outage cannot burn the Sentry budget', () => {
  const { api, reports, ChatSendError } = loadSendErrors();
  for (let i = 0; i < 50; i += 1) {
    api.reportChatSendFailure('text', new ChatSendError('CHAT_ACK_TIMEOUT'));
  }
  assert.equal(reports.length, 1);
  // 不同类型 / 不同错误码仍是独立信号。
  api.reportChatSendFailure('voice', new ChatSendError('CHAT_ACK_TIMEOUT'));
  api.reportChatSendFailure('text', new ChatSendError('CHAT_INVALID_PAYLOAD'));
  assert.equal(reports.length, 3);

  api.resetChatSendFailureTelemetry();
  api.reportChatSendFailure('text', new ChatSendError('CHAT_ACK_TIMEOUT'));
  assert.equal(reports.length, 4);
});

test('the failing send path actually calls the reporter', () => {
  const client = fs.readFileSync(
    path.join(process.cwd(), 'src/chat-core/client.ts'),
    'utf8',
  );
  // release 包里屏幕侧的 console.warn 被 transform-remove-console 剥掉,
  // 这一行是生产环境唯一的发送失败信号。
  assert.match(client, /reportChatSendFailure\(options\.type, error\)/);
});
