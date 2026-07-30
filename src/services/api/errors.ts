import i18n from '@/i18n';
import { ApiError } from '@/services/api/client';
import { isKnownServerErrorCode } from '@/services/api/server-error-codes';

/**
 * 把任意抛出的错误转成一句可展示给用户的文案。
 *
 * 后端稳定错误码(ApiError.errorCode,如 AUTH_INVALID_CREDENTIALS)优先走 i18n
 * `serverErrors.<code>` 做本地化;未知 code 不展示后端 message,直接回落调用方 fallback,
 * 避免把服务端内部错误文本暴露给用户。用全局 i18n.t(而非 useTranslation)因为本函数在 catch /
 * 事件回调里按调用时机取当前语言,不在渲染期。
 */
export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.errorCode) {
      if (!isKnownServerErrorCode(error.errorCode)) {
        return fallback;
      }
      return i18n.t(`serverErrors.${error.errorCode}`, {
        defaultValue: fallback,
      });
    }
    return fallback;
  }

  if (
    error instanceof Error &&
    error.name === 'AvatarFrameResponseValidationError'
  ) {
    return fallback;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}
