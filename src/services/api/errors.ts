import i18n from '@/i18n';
import { ApiError } from '@/services/api/client';
import { isKnownServerErrorCode } from '@/services/api/server-error-codes';
import { isUserFacingError } from '@/utils/user-facing-error';

/**
 * 把任意抛出的错误转成一句可展示给用户的文案。
 *
 * 后端稳定错误码(ApiError.errorCode,如 AUTH_INVALID_CREDENTIALS)优先走 i18n
 * `serverErrors.<code>` 做本地化;未知 code 不展示后端 message,直接回落调用方 fallback,
 * 避免把服务端内部错误文本暴露给用户。用全局 i18n.t(而非 useTranslation)因为本函数在 catch /
 * 事件回调里按调用时机取当前语言,不在渲染期。
 *
 * 普通 Error 的 message 一律不透出 —— 那里装的是「Failed to fetch」「websocket
 * error」、TypeError 文本或服务端内部消息,不是给用户看的。可以直出的只有三类,
 * 共同点是文案由我们自己按当前语言构造:
 * - status 0 的 ApiError:客户端自造的超时/断网文案(见 client.ts bodyReadError 等);
 * - UserFacingError:业务代码显式标记「这句就是写给用户的」;
 * - StorageUploadError:上传模块构造、已去掉签名 URL/对象 key 的安全文案
 *   (与 send-errors.getChatSendErrorMessage 的既有白名单同一条线)。
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
    if (error.status === 0 && error.message) {
      return error.message;
    }
    return fallback;
  }

  if (isUserFacingError(error) && error.message) {
    return error.message;
  }

  if (
    error instanceof Error &&
    error.name === 'StorageUploadError' &&
    error.message
  ) {
    return error.message;
  }

  return fallback;
}
