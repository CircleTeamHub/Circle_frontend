import type { AssistantBootstrapResponse } from '@/features/assistant/types';
import { getChatDetailHref, type UserProfileScope } from '@/features/user/utils/routes';

/**
 * 打开 AI 小助手时是直接进聊天，还是先走订阅引导：没有订阅能力，或者已经有一条
 * 生效的圈子帖子订阅（带圈子上下文时要是这个圈子的）就直接进聊天。
 * 「探索」入口和引导页共用这一条判断，两边不能各写一份。
 */
export function opensAssistantChatDirectly(
  bootstrap: AssistantBootstrapResponse,
  contextCircleId?: string | null,
): boolean {
  if (!bootstrap.capabilities.infoSubscriptions) return true;
  return bootstrap.subscriptions.some(
    (subscription) =>
      subscription.enabled &&
      subscription.sourceTypes.includes('PLAZA_POST') &&
      (!contextCircleId || subscription.circleId === contextCircleId),
  );
}

/** 小助手会话在本栈的聊天页地址：从探索进来就留在探索，返回落回探索首页。 */
export function getAssistantChatHref(
  scope: UserProfileScope,
  bootstrap: AssistantBootstrapResponse,
) {
  const chatHref = getChatDetailHref(
    scope,
    bootstrap.conversation.id,
    bootstrap.assistant.displayName,
    undefined,
    bootstrap.conversation.id,
  );
  return {
    pathname: chatHref.pathname,
    params: {
      ...chatHref.params,
      conversationKind: 'support' as const,
      assistantKey: bootstrap.assistant.key,
    },
  };
}
