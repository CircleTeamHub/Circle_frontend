/**
 * api/conversation-groups.ts — 用户自定义会话分组 CRUD
 *
 * 后端：/api/v1/conversation-groups
 * 概念：用户给一组会话（私聊 / 群聊都行）打个 label，比如「家人」「工作」。
 *       pinnedToTabs 决定该分组是否出现在 MessagesScreen 顶部 filter tab。
 *
 * 服务端是 last-write-wins 替换语义：setMembers 一次性发完整列表。
 */
import { apiClient } from '@/services/api/client';
import type { CustomConversationGroup } from '@/types';

export async function fetchConversationGroups(): Promise<CustomConversationGroup[]> {
  return apiClient<CustomConversationGroup[]>('/conversation-groups');
}

export async function createConversationGroup(payload: {
  name: string;
  pinnedToTabs?: boolean;
  sortOrder?: number;
}): Promise<CustomConversationGroup> {
  return apiClient<CustomConversationGroup>('/conversation-groups', {
    method: 'POST',
    body: payload,
  });
}

export async function updateConversationGroup(
  id: string,
  patch: { name?: string; pinnedToTabs?: boolean; sortOrder?: number },
): Promise<CustomConversationGroup> {
  return apiClient<CustomConversationGroup>(`/conversation-groups/${id}`, {
    method: 'PATCH',
    body: patch,
  });
}

export async function deleteConversationGroup(id: string): Promise<void> {
  await apiClient<void>(`/conversation-groups/${id}`, {
    method: 'DELETE',
  });
}

export async function setConversationGroupMembers(
  id: string,
  conversationIDs: string[],
): Promise<CustomConversationGroup> {
  return apiClient<CustomConversationGroup>(`/conversation-groups/${id}/members`, {
    method: 'PUT',
    body: { conversationIDs },
  });
}
