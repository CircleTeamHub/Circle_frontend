/**
 * 「这次写操作到底有没有落到服务端」的判别。
 *
 * 只有真的不知道结果才算不确定。断网（failureKind 'network'）不算 —— 连接压根
 * 没建立，请求没离开设备；把它算成不确定，会让断网注册提示「请先尝试登录或找回
 * 密码」，而账号根本没建出来，用户被推去登录一个不存在的账号。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// 真模块，不是手抄件：判别逻辑一改，这里跟着变。
const { ApiError } = loadTsModule('src/services/api/api-error.ts');
const { isAmbiguousMutationFailure } = loadTsModule(
  'src/services/api/mutation-outcome.ts',
  { requireShim: (request) => (request === './api-error' ? { ApiError } : require(request)) },
);

const apiError = (options) => new ApiError('failed', options);

test('响应没读全（timeout / body-read）→ 结果不确定', () => {
  assert.equal(
    isAmbiguousMutationFailure(apiError({ status: 0, failureKind: 'timeout' })),
    true,
  );
  assert.equal(
    isAmbiguousMutationFailure(
      apiError({ status: 0, failureKind: 'body-read' }),
    ),
    true,
  );
});

test('5xx → 结果不确定（服务端可能已提交才炸）', () => {
  assert.equal(isAmbiguousMutationFailure(apiError({ status: 500 })), true);
  assert.equal(isAmbiguousMutationFailure(apiError({ status: 503 })), true);
});

test('断网 → 确定没发生，不能报「结果不确定」', () => {
  assert.equal(
    isAmbiguousMutationFailure(apiError({ status: 0, failureKind: 'network' })),
    false,
  );
});

test('明确的 4xx → 确定失败，重试是对的', () => {
  assert.equal(isAmbiguousMutationFailure(apiError({ status: 400 })), false);
  assert.equal(isAmbiguousMutationFailure(apiError({ status: 409 })), false);
  assert.equal(
    isAmbiguousMutationFailure(
      apiError({ status: 422, failureKind: 'api-code' }),
    ),
    false,
  );
});

test('不是 ApiError 的抛出值 → 来路不明，保守视为结果不确定', () => {
  assert.equal(isAmbiguousMutationFailure(null), true);
  assert.equal(isAmbiguousMutationFailure('connection reset'), true);
  assert.equal(isAmbiguousMutationFailure(new Error('boom')), true);
  // 形状像但不是 ApiError（比如响应体解析成功后我们自己抛的业务错误）。
  assert.equal(isAmbiguousMutationFailure({ status: 400 }), true);
});
