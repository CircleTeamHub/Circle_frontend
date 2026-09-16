import { router, useNavigation } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getChatInfoTopHref,
  getTabHomeHref,
  getUserProfileHref,
  type UserProfileScope,
} from '@/features/user/utils/routes';
import { type ChatMessage } from '@/types';
import { Alert } from 'react-native';
import { fetchChatMembers } from '@/chat-core/api';
import { useChatStore } from '@/chat-core/store';
import { usePeerPresence } from '@/chat-core/use-peer-presence';
import { type ThemeColors } from '@/theme';
import { type TFunction } from 'i18next';
import { type AuthUser } from '@/stores/authStore';
import { type ConversationKind } from '@/features/chat/chat-detail/types';

export interface ChatHeaderParams {
  colors: ThemeColors;
  t: TFunction<"translation", undefined>;
  scope: UserProfileScope;
  currentUserID: string | null;
  authUser: AuthUser | null;
  sourceID: string;
  conversationID: string;
  isTempChat: boolean;
  conversationType: ConversationKind;
  isGroupChat: boolean;
  canViewMemberProfilesByPolicy: boolean;
  revalidateMemberViewAccess: () => Promise<boolean>;
  conversationTitle: string;
}

/**
 * 聊天页头部:返回、打开群信息/成员资料/名片(带成员目录与资料可见性的实时校验),
 * 以及副标题(自己 / 正在输入 / 群聊 / 对端在线状态)。
 */
export function useChatHeader({
  colors,
  t,
  scope,
  currentUserID,
  authUser,
  sourceID,
  conversationID,
  isTempChat,
  conversationType,
  isGroupChat,
  canViewMemberProfilesByPolicy,
  revalidateMemberViewAccess,
  conversationTitle,
}: ChatHeaderParams) {
  const navigation = useNavigation();
  const handleBack = useCallback(() => {
    if (navigation.canGoBack()) {
      router.back();
    } else {
      // 没有可回退栈时回到来源 tab 首页，而不是固定回消息首页。
      router.replace(getTabHomeHref(scope));
    }
  }, [navigation, scope]);

  const openGroupInfo = useCallback(() => {
    router.push(
      getChatInfoTopHref(scope, {
        conversationID,
        sourceID,
        title: conversationTitle,
        conversationType: 'group',
        ...(isTempChat ? { conversationKind: 'temp' } : {}),
        originScope: scope,
      }),
    );
  }, [scope, conversationID, sourceID, conversationTitle, isTempChat]);

  const handleOpenMessageSender = useCallback(
    async (msg: ChatMessage) => {
      if (isGroupChat) {
        // 群聊：跳该消息发送者本人的资料（senderID 已还原成 UUID 形式）。
        if (!msg.senderID) return;
        // review P1：点击瞬间 fail-closed 重查角色，不信挂载期的旧快照。
        if (
          msg.senderID !== currentUserID &&
          !(await revalidateMemberViewAccess())
        ) {
          Alert.alert(t('chat.groupMembersRestricted'));
          return;
        }
        // 「成员可查看他人资料」策略:群主/管理员不受限,看自己永远放行。
        if (msg.senderID !== currentUserID && !canViewMemberProfilesByPolicy) {
          Alert.alert(
            t('chat.profilesRestrictedByGroup', {
              defaultValue: '该群未开放查看成员资料',
            }),
          );
          return;
        }
        router.push(
          getUserProfileHref(scope, msg.senderID, msg.senderName, {
            viaConversationID: conversationID,
          }),
        );
        return;
      }
      // 单聊：对方即会话 sourceID。
      router.push(getUserProfileHref(scope, sourceID, conversationTitle));
    },
    [
      canViewMemberProfilesByPolicy,
      conversationID,
      conversationTitle,
      currentUserID,
      sourceID,
      isGroupChat,
      revalidateMemberViewAccess,
      scope,
      t,
    ],
  );

  const handleOpenUserCard = useCallback(
    async (userID: string, nickname?: string) => {
      if (isGroupChat && userID !== currentUserID) {
        const allowed = await revalidateMemberViewAccess();
        if (!allowed) {
          // review P2：名片可能是分享进群的外部用户——确认不是本群成员才放行。
          // review R2：身份查不清（查询失败）时 fail-closed 拦截，否则断网就
          // 成了绕过成员目录限制的口子；只有明确查到"不在群里"才按分享意图放行。
          let blockTarget = true;
          try {
            const members = await fetchChatMembers(conversationID);
            blockTarget = members.some((member) => member.userId === userID);
          } catch {
            blockTarget = true;
          }
          if (blockTarget) {
            Alert.alert(t('chat.groupMembersRestricted'));
            return;
          }
        }
      }
      router.push(getUserProfileHref(scope, userID, nickname));
    },
    [conversationID, currentUserID, isGroupChat, revalidateMemberViewAccess, scope, t],
  );

  const handleOpenHeaderTarget = useCallback(() => {
    // 群聊点头部头像 → 进群信息（与右上角 ⋮ 一致）；单聊 → 进个人资料。
    if (isGroupChat) {
      openGroupInfo();
      return;
    }
    router.push(getUserProfileHref(scope, sourceID, conversationTitle));
  }, [isGroupChat, openGroupInfo, scope, sourceID, conversationTitle]);

  // 单聊场景下订阅对方在线状态。订阅 Promise 立刻返回当前快照，
  // 之后由全局 onUserStatusChanged 维护增量。
  const peerImId = useMemo(
    () =>
      conversationType === 'single' && sourceID ? sourceID : null,
    [conversationType, sourceID],
  );
  // 对端「正在输入」有效期;到期自动回落在线状态。
  const typingUntil = useChatStore(
    (state) => state.typingUntilByConversation[conversationID] ?? 0,
  );
  const [typingVisible, setTypingVisible] = useState(false);
  useEffect(() => {
    const remaining = typingUntil - Date.now();
    if (remaining <= 0) {
      setTypingVisible(false);
      return;
    }
    setTypingVisible(true);
    const timer = setTimeout(() => setTypingVisible(false), remaining);
    return () => clearTimeout(timer);
  }, [typingUntil]);

  // 只订阅对方这一个用户的在线状态切片(chat-core presence),
  // 其他用户上下线不触发本页重渲染;离线时带「N 分钟前在线」并每分钟刷新。
  const peerPresence = usePeerPresence(peerImId);
  const peerOnline = peerPresence.online;
  const statusColor =
    conversationType !== 'single' || authUser?.accountId === sourceID
      ? colors.online
      : peerOnline
        ? colors.online
        : colors.textSecondary;
  // 头部副标题:自己 > 正在输入 > 群聊 > 对方在线 / 最近在线。单聊对方关了
  // 「显示在线时间」(或还没拿到状态)时整行不画 —— 画「离线」仍是在泄露信息。
  const headerStatusText =
    authUser?.accountId === sourceID
      ? t('chat.detail.statusSelf', { defaultValue: '自己' })
      : // 群聊分支原来直接落「群聊」二字,typingVisible 根本没机会参与判断 ——
        // 群成员照常上报 typing,却没有任何人看得见。
        typingVisible
        ? conversationType !== 'single'
          ? t('chat.detail.statusTypingGroup', {
              defaultValue: '有人正在输入…',
            })
          : t('chat.detail.statusTyping', { defaultValue: '对方正在输入…' })
        : conversationType !== 'single'
          ? t('chat.detail.statusGroup', { defaultValue: '群聊' })
          : peerPresence.known
            ? peerPresence.label
            : '';

  return {
    handleBack,
    handleOpenMessageSender,
    handleOpenUserCard,
    handleOpenHeaderTarget,
    statusColor,
    headerStatusText,
  };
}
