import type { TFunction } from 'i18next';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import type { ChatTarget } from './types';
import type { ResolvedChatTarget } from './resolve-chat-target';

import type { UserProfileScope } from '@/features/user/utils/routes';
interface AnnounceSentInput {
  t: TFunction;
  targets: readonly ChatTarget[];
  /** 后台发送里落到会话 id 的结果;「查看」要等它才知道跳哪个会话。 */
  resolution: Promise<readonly ResolvedChatTarget[]>;
  /** 关掉选择页(两个按钮都会先调它)。 */
  onDismiss: () => void;
  /** 选择页所在的 tab 栈:「查看」一个聊天时在这个栈里打开,返回回到来处。 */
  scope: UserProfileScope;
}

function chatDetailParams(target: ChatTarget, conversationId: string) {
  const isGroup = target.kind !== 'direct';
  return {
    conversationID: conversationId,
    // 私聊的 sourceID 是对方用户 id,独立群聊和临时群是会话 id;圈子群是圈子 id
    // (成员目录/圈子详情都按它取,见 mapChatConversationToUI)—— 拿会话 id 顶替会让
    // 聊天页的成员权限全部按「查不到」处理。
    sourceID: isGroup
      ? (target.circleId ?? conversationId)
      : (target.userId ?? conversationId),
    title: target.name,
    conversationType: isGroup ? 'group' : 'private',
    ...(target.kind === 'temp' ? { conversationKind: 'temp' } : {}),
    ...(target.avatarUrl ? { avatarUrl: target.avatarUrl } : {}),
  };
}

/**
 * 点了发送就立刻提示「已发送」,内容在后台接着发:进了发送队列的消息已经出现在
 * 目标会话里,发不出去的在那里标红可重发,不必让人对着选择页等。
 * 「查看」发给一个聊天时进那个聊天,发给多个时回到消息列表(它们都排在最上面)。
 */
export function announceSent({ t, targets, resolution, onDismiss, scope }: AnnounceSentInput): void {
  const view = async () => {
    onDismiss();
    if (targets.length !== 1) {
      router.navigate('/(tabs)/messages');
      return;
    }
    const target = targets[0];
    const resolved = (await resolution).find((item) => item.target.key === target.key);
    // 建会话失败时后台已经提示过原因,这里不再跳。
    if (!resolved) return;
    router.push({
      pathname: `/(tabs)/${scope}/chat-detail`,
      params: chatDetailParams(target, resolved.conversationId),
    });
  };
  Alert.alert(t('chat.targetPicker.sent', { defaultValue: '已发送' }), undefined, [
    { text: t('common.confirm'), onPress: onDismiss },
    {
      text: t('chat.targetPicker.view', { defaultValue: '查看' }),
      onPress: () => void view(),
    },
  ]);
}
