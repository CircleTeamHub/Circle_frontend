import { apiClient } from '@/services/api/client';
import { expectShape, isNonEmptyString, isPlainObject } from '@/utils/validate';
import i18n from '@/i18n';

export interface CustomSticker {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
  createdAt: string;
}
export type StickerSource = { messageId: string; objectKey?: never; width?: never; height?: never } | { objectKey: string; messageId?: never; width?: number; height?: number };

function isSticker(value: unknown): value is CustomSticker {
  return isPlainObject(value) && isNonEmptyString(value.id) && isNonEmptyString(value.url) &&
    (value.width === null || typeof value.width === 'number') &&
    (value.height === null || typeof value.height === 'number') && isNonEmptyString(value.createdAt);
}

export async function fetchStickers(): Promise<CustomSticker[]> {
  return expectShape(await apiClient('/stickers'), (value): value is CustomSticker[] => Array.isArray(value) && value.length <= 200 && value.every(isSticker), i18n.t('chat.stickers.loadFailed'));
}
export async function createSticker(source: StickerSource): Promise<CustomSticker> {
  return expectShape(await apiClient('/stickers', { method: 'POST', body: source }), isSticker, i18n.t('chat.stickers.saveFailed'));
}
export function removeSticker(id: string): Promise<void> {
  return apiClient(`/stickers/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
export async function prepareStickerMessage(id: string): Promise<{ key: string; width?: number; height?: number }> {
  return expectShape(await apiClient(`/stickers/${encodeURIComponent(id)}/message-media`, { method: 'POST' }),
    (value): value is { key: string; width?: number; height?: number } => isPlainObject(value) && isNonEmptyString(value.key) && (value.width === undefined || typeof value.width === 'number') && (value.height === undefined || typeof value.height === 'number'),
    i18n.t('chat.stickers.sendFailed'));
}
