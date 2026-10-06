import { useCallback } from 'react';
import { type ChatMessage } from '@/types';
import { isLocalMessageId } from '@/chat-core/local-message-id';
import {
  buildCollectionInputFromMessage,
  buildNoteCollectSource,
} from '@/features/chat/utils/message-collection';
import { collectNote } from '@/services/api/notes';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import { reportHandledFailure } from '@/observability/report-failure';
import { getApiErrorMessage } from '@/services/api/errors';
import { useChatStore } from '@/chat-core/store';
import { createCollection } from '@/services/api/collections';
import { type TFunction } from 'i18next';

export interface CollectMessageParams {
  t: TFunction<"translation", undefined>;
  currentUserID: string | null;
  sourceID: string;
  conversationID: string;
  isGroupChat: boolean;
  conversationTitle: string;
  avatarUrl: string | undefined;
  selfAvatarUri: string | undefined;
  selfName: string | undefined;
}

/**
 * 长按菜单的「收藏」:普通消息进收藏列表(自己发的语音连 object key 一起存,才能重发),
 * 笔记卡片则快照复制进「我的笔记」并带上来源名片。
 */
export function useCollectMessage({
  t,
  currentUserID,
  sourceID,
  conversationID,
  isGroupChat,
  conversationTitle,
  avatarUrl,
  selfAvatarUri,
  selfName,
}: CollectMessageParams) {
  const handleCollectMessage = useCallback(
    async (message: ChatMessage) => {
      if (!conversationID) return;
      // 还没拿到 ack 的气泡手上只有 local:<d>,服务端那条消息还不存在 ——
      // 收藏接口会按 COLLECTION_INVALID_MESSAGE_SOURCE 拒掉它。菜单已经不给入口,
      // 这里是兜底(长按菜单与发送 ack 之间存在竞态)。
      if (isLocalMessageId(message.id)) return;

      // 笔记卡片：不进「收藏」列表，直接快照复制进「我的笔记」，
      // 并带上来源名片（群/用户）+ 消息定位信息，详情页可一键跳回聊天。
      if (message.type === 'note-card') {
        const source = buildNoteCollectSource(message, {
          conversationID,
          conversationTitle,
          sourceID,
          conversationType: isGroupChat ? 'group' : 'private',
          conversationAvatarUrl: avatarUrl,
          currentUser: {
            id: currentUserID ?? undefined,
            name: selfName,
            faceURL: selfAvatarUri,
          },
        });
        if (!source || !message.noteCard) return;

        try {
          const result = await collectNote(message.noteCard.noteId, source);
          // 复制出来的是「我的」那条笔记（id 与原笔记不同），「查看」跳它。
          const copiedNoteId = result.note?.id;
          Alert.alert(
            result.alreadyCollected
              ? t('chat.messageActions.noteAlreadyCollected', {
                  defaultValue: '已在我的笔记中',
                })
              : t('chat.messageActions.noteCollected', {
                  defaultValue: '已添加到我的笔记',
                }),
            t('chat.messageActions.noteCollectedHint', {
              defaultValue: '可在「我的笔记」中查看',
            }),
            copiedNoteId
              ? [
                  {
                    text: t('common.view', { defaultValue: '查看' }),
                    // 跳「我的笔记」列表并定位到刚添加的这条（不是直接开详情）：
                    // 用户要看的是它在自己列表里的位置。
                    onPress: () =>
                      router.push({
                        pathname: '/(tabs)/profile/notes',
                        params: { highlightNoteId: copiedNoteId },
                      } as never),
                  },
                  { text: t('common.confirm', { defaultValue: '确认' }) },
                ]
              : undefined,
          );
        } catch (error) {
          reportHandledFailure('chatDetail', 'collectNote', error);
          Alert.alert(
            t('chat.messageActions.collectFailed'),
            getApiErrorMessage(error, t('chat.messageActions.collectFailedHint')),
          );
        }
        return;
      }

      // 语音要把源 DTO 的 object key 一起收下来:UI 层的 voiceUrl 是服务端
      // 现签的临时地址,过期即失效,推不回 key —— 不存 key 的话这条收藏
      // 以后永远重发不出去(旧收藏正是卡在这里)。
      //
      // 但只收**自己发的**:key 是发送方的对象路径(chat/{senderId}/…),
      // 后端发送校验按 chat/{当前用户}/ 收口。把对端的 key 也存下来的话,
      // 收藏页会把它显示成「可重发」,而每一次重发都必然被后端拒掉 ——
      // 一个点了就报错的按钮比一个不出现的按钮更糟。收到的语音要做成可重发,
      // 得先把音频复制/重传到自己名下,那是另一件事。
      const sourceMessage =
        message.type === 'voice'
          ? useChatStore
              .getState()
              .messagesByConversation[conversationID]?.find(
                (item) => item.id === message.id,
              )
          : undefined;
      const sourceKey = sourceMessage?.content?.['key'];
      const voiceKey =
        sourceMessage?.sender?.id === currentUserID &&
        typeof sourceKey === 'string'
          ? sourceKey
          : undefined;

      const input = buildCollectionInputFromMessage(message, {
        conversationID,
        conversationTitle,
        sourceID,
        conversationType: isGroupChat ? 'group' : 'private',
        voiceKey,
      });
      if (!input) return;

      try {
        await createCollection(input);
        Alert.alert(
          t('chat.messageActions.collected'),
          t('chat.messageActions.collectedHint'),
        );
      } catch (error) {
        reportHandledFailure('chatDetail', 'collectMessage', error);
        Alert.alert(
          t('chat.messageActions.collectFailed'),
          getApiErrorMessage(error, t('chat.messageActions.collectFailedHint')),
        );
      }
    },
    [
      avatarUrl,
      conversationID,
      conversationTitle,
      currentUserID,
      isGroupChat,
      selfAvatarUri,
      selfName,
      sourceID,
      t,
    ],
  );

  return {
    handleCollectMessage,
  };
}
