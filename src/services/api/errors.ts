import i18n from '@/i18n';
import { ApiError } from '@/services/api/client';

/**
 * 把任意抛出的错误转成一句可展示给用户的文案。
 *
 * 后端稳定错误码(ApiError.errorCode,如 AUTH_INVALID_CREDENTIALS)优先走 i18n
 * `serverErrors.<code>` 做本地化;当前 locale 缺该 key 时回落后端 message(仍是人类可读),
 * 再回落调用方给的 fallback。用全局 i18n.t(而非 useTranslation)因为本函数在 catch /
 * 事件回调里按调用时机取当前语言,不在渲染期。
 */
export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.errorCode) {
      return i18n.t(`serverErrors.${error.errorCode}`, {
        defaultValue: error.message || fallback,
      });
    }
    return error.message || fallback;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}
