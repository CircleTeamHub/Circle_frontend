import { type Dispatch, type RefObject, type SetStateAction, useCallback } from 'react';
import { router } from 'expo-router';
import {
  type AttachmentId,
  PANEL_LAYOUT_ANIM,
} from '@/features/chat/chat-detail/constants';
import { Alert, LayoutAnimation } from 'react-native';
import { type FriendProfile } from '@/services/api/friends';
import { sendCardMessage, sendVoiceMessage } from '@/chat-core/client';
import { startChatSend } from '@/chat-core/send-handle';
import { getChatSendErrorMessage } from '@/chat-core/send-errors';
import { type UserCollection } from '@/services/api/collections';
import { resolveCollectionSendPlan } from '@/features/chat/utils/message-collection';
import { logChatSendFailure } from '@/features/chat/chat-detail/helpers';
import { type TFunction } from 'i18next';

export interface AttachmentActionsParams {
  t: TFunction<"translation", undefined>;
  inFlightRef: RefObject<boolean>;
  setSendError: Dispatch<SetStateAction<string | null>>;
  setAttachmentOpen: Dispatch<SetStateAction<boolean>>;
  mountedRef: RefObject<boolean>;
  sourceID: string;
  conversationID: string;
  conversationType: "group" | "single";
  isGroupChat: boolean;
  conversationTitle: string;
  avatarUrl: string | undefined;
  isPreviewMode: boolean;
  handleStartCall: () => void;
  sendDraftAsText: (text: string) => Promise<void>;
  handleOpenLocationPicker: () => Promise<void>;
  setMediaSourceSheetVisible: Dispatch<SetStateAction<boolean>>;
}

/**
 * 聊天输入栏「+」面板里各入口的动作:媒体、通话、位置、笔记/名片/收藏选择页,
 * 以及选中名片、收藏、快捷短语后的发送。
 */
export function useAttachmentActions({
  t,
  inFlightRef,
  setSendError,
  setAttachmentOpen,
  mountedRef,
  sourceID,
  conversationID,
  conversationType,
  isGroupChat,
  conversationTitle,
  avatarUrl,
  isPreviewMode,
  handleStartCall,
  sendDraftAsText,
  handleOpenLocationPicker,
  setMediaSourceSheetVisible,
}: AttachmentActionsParams) {
  const openSharePicker = useCallback(
    (type: 'note' | 'friend' | 'favorite' | 'quick-reply') => {
      router.push({
        pathname: '/(tabs)/messages/share-picker',
        params: { type },
      });
    },
    [],
  );


  const handleAttachmentAction = useCallback(
    (id: AttachmentId) => {
      LayoutAnimation.configureNext(PANEL_LAYOUT_ANIM);
      setAttachmentOpen(false);
      switch (id) {
        case 'media':
          setMediaSourceSheetVisible(true);
          return;
        case 'notes':
          openSharePicker('note');
          return;
        case 'friend-card':
          openSharePicker('friend');
          return;
        case 'favorites':
          openSharePicker('favorite');
          return;
        case 'quick-reply':
          openSharePicker('quick-reply');
          return;
        case 'location':
          void handleOpenLocationPicker();
          return;
        case 'voice-call':
          void handleStartCall();
          return;
        case 'transfer':
          if (conversationType !== 'single') {
            Alert.alert(t('chat.transferTitle'), t('chat.transferGroupNotSupported'));
            return;
          }
          if (!sourceID) return;
          router.push({
            pathname: '/(tabs)/messages/transfer-composer',
            params: {
              recipientId: sourceID,
              recipientName: conversationTitle,
              recipientAvatar: avatarUrl ?? '',
            },
          });
          return;
      }
    },
    [
      avatarUrl,
      conversationTitle,
      conversationType,
      handleOpenLocationPicker,
      handleStartCall,
      openSharePicker,
      sourceID,
      t,
      setAttachmentOpen,
      setMediaSourceSheetVisible,
    ],
  );

  const handlePickFriend = useCallback(
    async (friend: FriendProfile) => {
      if (!conversationID) return;
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      const reportSendFailure = (error: unknown) => {
        if (mountedRef.current) {
          setSendError(
            getChatSendErrorMessage(
              error,
              t('chat.detail.cardSendFailed', {
                defaultValue: '名片发送失败，请重试',
              }),
            ),
          );
        }
      };
      // 进了发送队列就放开输入栏,不等送达(断线时会等到重连)。
      try {
        const handle = startChatSend((onCreate) =>
          sendCardMessage({
            conversationId: conversationID,
            type: 'friend-card',
            payload: {
              userID: friend.id,
              nickname: friend.nickname,
              faceURL: friend.avatarUrl ?? '',
            },
            onCreate,
          }),
        );
        if (handle.queued) {
          void handle.delivered.catch(reportSendFailure);
        } else {
          await handle.delivered;
        }
      } catch (error) {
        reportSendFailure(error);
      } finally {
        inFlightRef.current = false;
      }
    },
    [conversationID, t, inFlightRef, mountedRef, setSendError],
  );

  const handlePickFavorite = useCallback(
    async (item: UserCollection) => {
      if (!sourceID || isPreviewMode) return;

      // 收藏的是啥就原样发啥：能按原类型还原的（文本/语音/笔记/名片）忠实重建，
      // 不加 title 等装饰；其余回退成干净文本。
      const plan = resolveCollectionSendPlan(item);

      // 文本走统一草稿发送路径（自带 inFlightRef 防抖）。
      if (plan.kind === 'text') {
        await sendDraftAsText(plan.text);
        return;
      }

      // 旧语音收藏(只存了会过期的播放地址、推不回 object key)是永久不可发的。
      // 这里必须在进入发送流程之前就拦下:抛异常的话会被下面的 catch 统一
      // 渲染成「发送失败,请重试」—— 而重试多少次都不可能成功。
      // 选择器那侧同样按 canResendCollection 把这类行禁用掉,双保险。
      if (plan.kind === 'unsupported') {
        if (mountedRef.current) {
          setSendError(
            t('chat.detail.favoriteLegacyVoiceUnsupported', {
              defaultValue: '这条旧版语音收藏无法重新发送',
            }),
          );
        }
        return;
      }

      if (inFlightRef.current) return;
      inFlightRef.current = true;
      const reportSendFailure = (error: unknown) => {
        logChatSendFailure(error, {
          kind: 'collectedItem',
          sessionType: conversationType,
          isGroupChat,
        });
        if (mountedRef.current) {
          setSendError(
            getChatSendErrorMessage(
              error,
              t('chat.detail.favoriteSendFailed', {
                defaultValue: '收藏内容发送失败，请重试',
              }),
            ),
          );
        }
      };
      // 进了发送队列就放开输入栏,不等送达(断线时会等到重连)。
      try {
        const handle = startChatSend((onCreate) => {
          switch (plan.kind) {
            case 'voice':
              // 收藏时存下的 object key 直接重发,不重新上传音频。
              return sendVoiceMessage({
                conversationId: conversationID,
                key: plan.key,
                duration: plan.duration,
                ...(plan.dataSize ? { size: plan.dataSize } : {}),
                onCreate,
              });
            case 'note':
              return sendCardMessage({
                conversationId: conversationID,
                type: 'note-card',
                payload: plan.noteCard,
                onCreate,
              });
            case 'friend':
              return sendCardMessage({
                conversationId: conversationID,
                type: 'friend-card',
                payload: {
                  userID: plan.friendCard.userID,
                  nickname: plan.friendCard.nickname,
                  faceURL: plan.friendCard.faceURL,
                  persona: plan.friendCard.persona,
                  displayIcons: plan.friendCard.displayIcons,
                },
                onCreate,
              });
          }
        });
        if (handle.queued) {
          void handle.delivered.catch(reportSendFailure);
        } else {
          await handle.delivered;
        }
      } catch (error) {
        reportSendFailure(error);
      } finally {
        inFlightRef.current = false;
      }
    },
    [
      conversationID,
      conversationType,
      isGroupChat,
      isPreviewMode,
      sendDraftAsText,
      sourceID,
      t,
      inFlightRef,
      mountedRef,
      setSendError,
    ],
  );

  const handlePickQuickReply = useCallback(
    async (phrase: string) => {
      await sendDraftAsText(phrase);
    },
    [sendDraftAsText],
  );

  // 转账卡片不在这里发。它断言的是「钱已经划走」这个服务端事实,客户端能发
  // 就等于能凭空捏造它 —— 后端已把该类型收进 SERVER_MESSAGE_TYPES,
  // 由 CoinService.sendGift 在结算提交后就地签发,走 chat:msg 广播下来。
  //
  // 这里曾经有一个对应的发送 handler,而它 100% 被 validateSendPayload 拒。
  // #156 已经把症状压住(SERVER_COMPENSATED_TYPES:不入 outbox、失败不留气泡),
  // 这次是拆掉病根 —— 发送本身没了,连带那条永远走不到的回执挂账。

  return {
    handleAttachmentAction,
    handlePickFriend,
    handlePickFavorite,
    handlePickQuickReply,
  };
}
