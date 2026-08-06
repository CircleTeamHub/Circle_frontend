import { apiClient } from '@/services/api/client';
import type { ChatConversationDto, ChatHistoryPageDto } from './protocol';
import { useChatStore } from './store';

/**
 * chat-core 的 REST 冷路径(circle_be /api/v1/chat/*)。
 * 实时收发走 socket-manager;这里承担打开 App/进页面时的全量拉取与翻页。
 */

/** 拉全量会话列表并写入 store(消息页 focus / 下拉刷新用)。 */
export async function loadChatConversations(): Promise<ChatConversationDto[]> {
  const conversations =
    await apiClient<ChatConversationDto[]>('/chat/conversations');
  useChatStore.getState().setConversations(conversations);
  return conversations;
}

/** 取或建单聊会话(个人资料页「发消息」等入口)。 */
export function createDirectChatConversation(
  peerUserId: string,
): Promise<ChatConversationDto> {
  return apiClient<ChatConversationDto>('/chat/conversations/direct', {
    method: 'POST',
    body: { peerUserId },
  });
}

/** 取或建圈子群会话(圈子详情「进群聊」等入口;进圈后首次调用即触发座位同步)。 */
export function createCircleChatConversation(
  circleId: string,
): Promise<ChatConversationDto> {
  return apiClient<ChatConversationDto>('/chat/conversations/circle', {
    method: 'POST',
    body: { circleId },
  });
}

/** 历史翻页:height 键集向前翻,页内升序;顺手灌进 store。 */
export async function loadChatHistory(
  conversationId: string,
  options: { beforeHeight?: number; limit?: number } = {},
): Promise<ChatHistoryPageDto> {
  const params = new URLSearchParams();
  if (options.beforeHeight !== undefined) {
    params.set('beforeHeight', String(options.beforeHeight));
  }
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  const query = params.toString();
  const page = await apiClient<ChatHistoryPageDto>(
    `/chat/conversations/${conversationId}/messages${query ? `?${query}` : ''}`,
  );
  useChatStore.getState().ingestMessages(conversationId, page.messages);
  return page;
}

/** 会话偏好:置顶/免打扰/隐藏。返回最新 DTO 并回写 store。 */
export async function updateChatConversationPreferences(
  conversationId: string,
  prefs: { pinned?: boolean; muted?: boolean; hidden?: boolean },
): Promise<ChatConversationDto> {
  const dto = await apiClient<ChatConversationDto>(
    `/chat/conversations/${conversationId}/preferences`,
    { method: 'PATCH', body: prefs },
  );
  const store = useChatStore.getState();
  if (prefs.hidden) {
    store.removeConversation(conversationId);
  } else {
    store.upsertConversation(dto);
  }
  return dto;
}
