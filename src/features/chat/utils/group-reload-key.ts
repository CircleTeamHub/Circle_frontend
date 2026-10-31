import type { ChatConversationDto } from '@/chat-core/protocol';
import { circlesMutatedSince } from '@/services/api/circles';
import { groupsMutatedSince } from '@/services/api/group-writes';

/**
 * 群页面(群聊信息、群管理)回到前台时的失效键:实时事件会改写的会话字段
 * (群名、公告、头像、群主、我的角色、人数、全员禁言、策略)任一变了就必须重拉。
 * 普通聊天消息只动 lastMessage,不在键里 —— 否则活跃群里闸门永远不放行。
 */
export function groupConversationReloadKey(
  conversation: ChatConversationDto | null | undefined,
): string {
  if (!conversation) return '';
  return JSON.stringify([
    conversation.name ?? null,
    conversation.notice ?? null,
    conversation.avatarUrl ?? null,
    conversation.ownerId ?? null,
    conversation.myRole ?? null,
    conversation.memberCount ?? null,
    conversation.muteAll ?? null,
    conversation.policies ?? null,
  ]);
}

/** 群页面显示的数据来自群写请求与圈子写请求(圈子群的名称/简介/人数)两路。 */
export function groupOrCircleMutatedSince(since: number): boolean {
  return groupsMutatedSince(since) || circlesMutatedSince(since);
}
