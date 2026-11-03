import { useCallback, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { TFunction } from 'i18next';
import { prepareStickerMessage, type CustomSticker } from '@/services/api/stickers';
import { sendImageMessage } from '@/chat-core/client';
import { startChatSend } from '@/chat-core/send-handle';
import { useAuthStore } from '@/stores/authStore';
import { assertMyTempChatConversationOpen } from '@/services/api/temp-chat';
import { getStickerErrorMessage } from '@/features/chat/utils/sticker-error';
export interface StickerSendParams {
  t: TFunction;
  conversationID: string;
  sourceID: string;
  isPreviewMode: boolean;
  composerLocked: boolean;
  isTempChat: boolean;
  inFlightRef: RefObject<boolean>;
  mountedRef: RefObject<boolean>;
  setSendError: Dispatch<SetStateAction<string | null>>;
}
export function useStickerSend({ t, conversationID, sourceID, isPreviewMode, composerLocked, isTempChat, inFlightRef, mountedRef, setSendError }: StickerSendParams) {
  const handleSendSticker = useCallback(async (sticker: CustomSticker) => {
    if (!sourceID || isPreviewMode || composerLocked || inFlightRef.current) return;
    const epoch = useAuthStore.getState().sessionEpoch;
    const current = () => mountedRef.current && useAuthStore.getState().sessionEpoch === epoch;
    const reportFailure = (error: unknown) => { if (current()) setSendError(getStickerErrorMessage(error, t, t('chat.stickers.sendFailed'))); };
    inFlightRef.current = true;
    setSendError(null);
    try {
      if (isTempChat) await assertMyTempChatConversationOpen(conversationID);
      if (!current()) return;
      const content = await prepareStickerMessage(sticker.id);
      if (!current()) return;
      const handle = startChatSend((onCreate) => sendImageMessage({ conversationId: conversationID, ...content, previewUrl: sticker.url, onCreate }));
      if (handle.queued) void handle.delivered.catch(reportFailure);
      else await handle.delivered;
    } catch (error) {
      reportFailure(error);
    } finally {
      inFlightRef.current = false;
    }
  }, [composerLocked, conversationID, inFlightRef, isPreviewMode, isTempChat, mountedRef, setSendError, sourceID, t]);
  return { handleSendSticker };
}
