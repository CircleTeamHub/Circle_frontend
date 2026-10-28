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
import { expectShape, isNonEmptyString, isPlainObject } from '@/utils/validate';
import type { CustomConversationGroup } from '@/types';

function isConversationGroup(value: unknown): value is CustomConversationGroup {
  return (
    isPlainObject(value) &&
    isNonEmptyString(value.id) &&
    typeof value.name === 'string' &&
    Number.isInteger(value.sortOrder) &&
    typeof value.pinnedToTabs === 'boolean' &&
    Array.isArray(value.conversationIDs) &&
    value.conversationIDs.every((id) => typeof id === 'string') &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string'
  );
}

function isConversationGroupArray(value: unknown): value is CustomConversationGroup[] {
  return Array.isArray(value) && value.every(isConversationGroup);
}

export async function fetchConversationGroups(): Promise<CustomConversationGroup[]> {
  const raw = await apiClient<unknown>('/conversation-groups');
  return expectShape(raw, isConversationGroupArray, '会话分组数据格式异常');
}

export async function createConversationGroup(payload: {
  name: string;
  pinnedToTabs?: boolean;
  sortOrder?: number;
}): Promise<CustomConversationGroup> {
  const raw = await apiClient<unknown>('/conversation-groups', {
    method: 'POST',
    body: payload,
  });
  return expectShape(raw, isConversationGroup, '会话分组数据格式异常');
}

export async function updateConversationGroup(
  id: string,
  patch: { name?: string; pinnedToTabs?: boolean; sortOrder?: number },
): Promise<CustomConversationGroup> {
  const raw = await apiClient<unknown>(`/conversation-groups/${id}`, {
    method: 'PATCH',
    body: patch,
  });
  return expectShape(raw, isConversationGroup, '会话分组数据格式异常');
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
  const raw = await apiClient<unknown>(`/conversation-groups/${id}/members`, {
    method: 'PUT',
    body: { conversationIDs },
  });
  return expectShape(raw, isConversationGroup, '会话分组数据格式异常');
}
