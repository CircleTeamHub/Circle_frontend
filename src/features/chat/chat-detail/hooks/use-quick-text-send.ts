import { type Dispatch, type RefObject, type SetStateAction, useCallback } from 'react';
import { sendTextMessage } from '@/chat-core/client';
import { logChatSendFailure } from '@/features/chat/chat-detail/helpers';
import { getChatSendErrorMessage } from '@/chat-core/send-errors';
import { type TFunction } from 'i18next';

export interface QuickTextSendParams {
  t: TFunction<"translation", undefined>;
  inFlightRef: RefObject<boolean>;
  setSendError: Dispatch<SetStateAction<string | null>>;
  mountedRef: RefObject<boolean>;
  sourceID: string;
  conversationID: string;
  conversationType: "group" | "single";
  isGroupChat: boolean;
  isPreviewMode: boolean;
}

/**
 * 发一段现成的文字(收藏里的文本、快捷短语)。不经过输入框,也不动输入框里的草稿。
 */
export function useQuickTextSend({
  t,
  inFlightRef,
  setSendError,
  mountedRef,
  sourceID,
  conversationID,
  conversationType,
  isGroupChat,
  isPreviewMode,
}: QuickTextSendParams) {
  const sendDraftAsText = useCallback(
    async (text: string) => {
      // 不日志 message 文本 —— 消息正文是 app 处理的最敏感数据。
      if (!text.trim() || !sourceID || isPreviewMode) {
        return;
      }
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      // 乐观发送在 chat-core 内完成:创建即上屏(height=0 发送中态),
      // ack 后同 d 替换,失败自动标失败态 —— 屏幕只负责错误展示。
      try {
        await sendTextMessage({ conversationId: conversationID, text });
      } catch (error) {
        logChatSendFailure(error, {
          kind: 'text',
          sessionType: conversationType,
          isGroupChat,
        });
        if (mountedRef.current) {
          setSendError(
            getChatSendErrorMessage(
              error,
              t('chat.detail.sendFailedText', {
                defaultValue: '消息发送失败，请重试',
              }),
            ),
          );
        }
      } finally {
        inFlightRef.current = false;
      }
    },
    [
      conversationID,
      conversationType,
      isGroupChat,
      isPreviewMode,
      sourceID,
      t,
      inFlightRef,
      mountedRef,
      setSendError,
    ],
  );

  return {
    sendDraftAsText,
  };
}
