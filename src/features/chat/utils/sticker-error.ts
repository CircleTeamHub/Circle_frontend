import type { TFunction } from 'i18next';
import { ApiError } from '@/services/api/api-error';
import { getApiErrorMessage } from '@/services/api/errors';

export function getStickerErrorMessage(error: unknown, t: TFunction, fallback: string): string {
  if (error instanceof ApiError && error.errorCode === 'STICKER_LIMIT_REACHED') return t('chat.stickers.limitReached');
  if (error instanceof ApiError && error.errorCode === 'STICKER_INVALID_IMAGE') return t('chat.stickers.tooLarge');
  return getApiErrorMessage(error, fallback);
}
