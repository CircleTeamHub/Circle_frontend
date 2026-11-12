import { Alert } from 'react-native';
import type { TFunction } from 'i18next';
import { clearChatConversationHistory, requestChatHistoryClear } from '@/chat-core/api';
import { reportHandledFailure } from '@/observability/report-failure';
import { getApiErrorMessage } from '@/services/api/errors';

/**
 * 「清空聊天记录」入口的确认流程。聊天信息页和输入栏的清除快捷键共用这一份，
 * 两处行为必须一模一样（G-14）：
 * - 私聊：交给调用方弹 ClearHistoryDialog（默认只清自己的，可勾「双向清空」）。
 * - 群聊：只有群主能推进全员水位，可选「仅删除我的记录 / 删除所有人的记录」；
 *   管理员和普通成员只能清自己那份。
 */
export function confirmClearChatHistory({
  conversationId,
  isGroupConversation,
  canClearGroupForEveryone,
  t,
  openDirectDialog,
}: {
  conversationId: string;
  isGroupConversation: boolean;
  canClearGroupForEveryone: boolean;
  t: TFunction;
  openDirectDialog: () => void;
}): void {
  const clearHistory = (forEveryone: boolean) => {
    void clearChatConversationHistory(conversationId, { forEveryone })
      .then(() => {
        Alert.alert(
          forEveryone
            ? t('chat.clearHistoryDoneDirect', { defaultValue: '双方聊天记录已删除' })
            : t('chat.clearHistoryDone'),
        );
      })
      .catch((error: unknown) => {
        reportHandledFailure('chatHistory', 'clearGroupHistory', error);
        Alert.alert(t('chat.clearHistory'), getApiErrorMessage(error, t('common.networkError')));
      });
  };

  if (isGroupConversation) {
    // 非群主只能清自己那份,不展示会被服务端拒绝的全群操作。
    if (!canClearGroupForEveryone) {
      Alert.alert(t('chat.clearHistory'), t('chat.clearHistoryConfirm'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('chat.clearHistory'),
          style: 'destructive',
          onPress: () => clearHistory(false),
        },
      ]);
      return;
    }

    Alert.alert(t('chat.clearHistory'), t('chat.clearHistoryConfirmGroupOwner'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('chat.clearHistoryForMe', { defaultValue: '仅删除我的记录' }),
        onPress: () => clearHistory(false),
      },
      {
        text: t('chat.clearHistoryForEveryone', { defaultValue: '删除所有人的记录' }),
        style: 'destructive',
        onPress: () => clearHistory(true),
      },
    ]);
    return;
  }

  // 私聊:默认只清自己的;勾「双向清空」再请对方授权清对方那份。
  openDirectDialog();
}

/**
 * 私聊清空聊天记录：先清自己的；bothSides 再拿清到的水位请对方授权清对方那份。
 * 结果用 Alert 告知。ClearHistoryDialog 确认后走这里（聊天信息页和输入栏共用）。
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
