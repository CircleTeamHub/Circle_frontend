/**
 * use-message-groups-store.ts — 自定义会话分组状态
 *
 * 该 store 已不再负责存储会话列表（会话数据由 useIMStore 从 OpenIM SDK 实时获取）。
 * 目前仅保留用户自定义群组（customGroups）的管理逻辑：
 * - 创建自定义分组
 * - 将群聊会话加入/移出某个自定义分组
 * - 按分组标签清空未读数（clearUnreadByFilter，仅影响 customGroupIds）
 */
import { create } from 'zustand';
import type { Conversation, CustomConversationGroup } from '@/types';


interface MessageGroupsState {
  conversations: Conversation[];
  customGroups: CustomConversationGroup[];
  addCustomGroup: (name: string) => string | null;
  toggleConversationInCustomGroup: (
    customGroupId: string,
    conversationId: string,
  ) => void;
  clearUnreadByFilter: (filterId: string) => void;
}

export const useMessageGroupsStore = create<MessageGroupsState>((set) => ({
  conversations: [],
  customGroups: [],
  addCustomGroup: (name) => {
    const trimmedName = name.trim();

    if (!trimmedName) {
      return null;
    }

    const id = `custom-group-${Date.now()}`;

    set((state) => ({
      customGroups: [...state.customGroups, { id, name: trimmedName }],
    }));

    return id;
  },
  toggleConversationInCustomGroup: (customGroupId, conversationId) => {
    set((state) => ({
      conversations: state.conversations.map((conversation) => {
        if (
          conversation.id !== conversationId ||
          conversation.conversationType !== 'group'
        ) {
          return conversation;
        }

        const currentIds = conversation.customGroupIds ?? [];
        const exists = currentIds.includes(customGroupId);

        return {
          ...conversation,
          customGroupIds: exists
            ? currentIds.filter((id) => id !== customGroupId)
            : [...currentIds, customGroupId],
        };
      }),
    }));
  },
  clearUnreadByFilter: (filterId) => {
    set((state) => ({
      conversations: state.conversations.map((conversation) => {
        const matches =
          filterId === 'all' ||
          filterId === 'unread' ||
          (filterId === 'group' && conversation.conversationType === 'group') ||
          (filterId === 'private' &&
            conversation.conversationType === 'private') ||
          (conversation.conversationType === 'group' &&
            (conversation.customGroupIds ?? []).includes(filterId));

        return matches ? { ...conversation, unreadCount: 0 } : conversation;
      }),
    }));
  },
}));
