/**
 * im/error-codes.ts — IM 客户端错误的稳定标识
 *
 * 独立小模块（零依赖）：chat-preview 等轻量消费方按 code 判定错误类别，
 * 不必 import 整个 im/client（那会把 OpenIM SDK 拖进无关 bundle），
 * 更不允许按 message 文本匹配 —— 文案随时会进 i18n，code 永不变（#99）。
 */
export const IM_ERROR_CODES = {
  /** 当前平台没有 OpenIM native 模块（web / Expo Go）。 */
  UNSUPPORTED_PLATFORM: 'IM_UNSUPPORTED_PLATFORM',
  /** SDK 已初始化但连接尚未就绪（登录中 / 断线重连中）。 */
  CONNECTION_NOT_READY: 'IM_CONNECTION_NOT_READY',
} as const;

export type IMErrorCode = (typeof IM_ERROR_CODES)[keyof typeof IM_ERROR_CODES];

export class IMClientError extends Error {
  readonly imErrorCode: IMErrorCode;

  constructor(imErrorCode: IMErrorCode, message: string) {
    super(message);
    this.name = 'IMClientError';
    this.imErrorCode = imErrorCode;
  }
}

/** 从任意 unknown 错误中安全取出 imErrorCode（无则 null）。 */
export function getIMErrorCode(error: unknown): IMErrorCode | null {
  if (!error || typeof error !== 'object') {
    return null;
  }
  const code = (error as { imErrorCode?: unknown }).imErrorCode;
  return code === IM_ERROR_CODES.UNSUPPORTED_PLATFORM ||
    code === IM_ERROR_CODES.CONNECTION_NOT_READY
    ? code
    : null;
}

/**
 * ⚠️ 跨仓数字契约：circle_be 的 OpenIM before-send 回调用这个 errCode 拒绝
 * 含敏感词的消息（circle_be src/sensitive-word/sensitive-word.constants.ts 的
 * SENSITIVE_WORD_BLOCKED_ERR_CODE），OpenIM 原样透传为 sendMessage 失败
 * （OpenIMApiError.code）。两边必须同步改。
 */
export const OPENIM_SENSITIVE_WORD_BLOCKED_CODE = 73001;

/** 发送失败是否因服务端敏感词拦截（duck-type，不 import SDK 错误类）。 */
export function isSensitiveWordBlockedError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  return (
    (error as { code?: unknown }).code === OPENIM_SENSITIVE_WORD_BLOCKED_CODE
  );
}
