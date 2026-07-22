const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

function read(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function loadPreviewModules() {
  const errorCodes = loadTsModule('src/im/error-codes.ts');
  const preview = loadTsModule('src/features/chat/chat-preview.ts', {
    requireShim: (specifier) => {
      if (specifier === '@/im/error-codes') return errorCodes;
      throw new Error(`unexpected import in chat-preview: ${specifier}`);
    },
  });
  return { errorCodes, preview };
}

test('chat preview fallback opens on stable IM error codes, not message text (#99)', () => {
  const { errorCodes, preview } = loadPreviewModules();
  const { IMClientError, IM_ERROR_CODES } = errorCodes;
  const { shouldOpenChatPreview } = preview;

  assert.equal(
    shouldOpenChatPreview(
      new IMClientError(IM_ERROR_CODES.CONNECTION_NOT_READY, '任意文案'),
    ),
    true,
  );
  assert.equal(
    shouldOpenChatPreview(
      new IMClientError(IM_ERROR_CODES.UNSUPPORTED_PLATFORM, 'whatever copy'),
    ),
    true,
  );

  // 文案匹配已废除：同样的中文消息、没有 code → 不再触发预览。
  assert.equal(
    shouldOpenChatPreview(new Error('IM 连接尚未完成，请稍后重试')),
    false,
  );
  assert.equal(shouldOpenChatPreview(new Error('网络错误')), false);
  assert.equal(shouldOpenChatPreview(null), false);
  // 伪造的 code 值不放行
  assert.equal(
    shouldOpenChatPreview({ imErrorCode: 'SOMETHING_ELSE' }),
    false,
  );
});

test('im/client throws IMClientError with codes at the two preview-relevant sites', () => {
  const client = read('src/im/client.ts');
  // 平台不支持：所有 throw 统一走带 code 的工厂
  assert.match(client, /function unsupportedPlatformError\(\)/);
  assert.doesNotMatch(client, /throw new Error\(getUnsupportedPlatformMessage\(\)\)/);
  // 连接未就绪：带 CONNECTION_NOT_READY code
  assert.match(
    client,
    /new IMClientError\(\s*IM_ERROR_CODES\.CONNECTION_NOT_READY/,
  );
  // chat-preview 不再持有任何错误文案字面量
  const preview = read('src/features/chat/chat-preview.ts');
  assert.doesNotMatch(preview, /仅支持|尚未完成/);
});
