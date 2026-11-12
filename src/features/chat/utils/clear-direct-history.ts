import { Alert } from 'react-native';
import type { TFunction } from 'i18next';
import { clearChatConversationHistory, requestChatHistoryClear } from '@/chat-core/api';
import { reportHandledFailure } from '@/observability/report-failure';
import { getApiErrorMessage } from '@/services/api/errors';

/**
 * 私聊清空聊天记录：先清自己的；bothSides 再拿清到的水位请对方授权清对方那份。
 * 结果用 Alert 告知。聊天设置页和输入栏「双向清空」快捷键共用这一份流程。
 */
export async function clearDirectChatHistory(
  conversationId: string,
  bothSides: boolean,
  t: TFunction,
): Promise<void> {
  try {
    const clearedBeforeHeight = await clearChatConversationHistory(conversationId, {
      forEveryone: false,
    });
    if (bothSides) {
      try {
        await requestChatHistoryClear(conversationId, clearedBeforeHeight);
      } catch (error) {
        // 自己这边已经清掉了,只是申请没发出去:别让用户以为什么都没清。
        reportHandledFailure('chatHistory', 'requestDirectHistoryClear', error);
        Alert.alert(
          t('chat.clearHistoryRequestFailed', {
            defaultValue: '已清空你的记录，双向清空申请发送失败',
          }),
          getApiErrorMessage(error, t('common.networkError')),
        );
        return;
      }
    }
    Alert.alert(
      bothSides
        ? t('chat.clearHistoryRequestSent', { defaultValue: '已清空，已向对方发送双向清空申请' })
        : t('chat.clearHistoryDone'),
    );
  } catch (error) {
    reportHandledFailure('chatHistory', 'clearDirectHistory', error);
    Alert.alert(t('chat.clearHistory'), getApiErrorMessage(error, t('common.networkError')));
  }
}
