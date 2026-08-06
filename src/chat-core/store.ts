import { create } from 'zustand';
import type { ChatConversationDto, ChatMessageDto } from './protocol';

/** 每会话内存消息上限（与旧 imStore 一致）：更早的历史走 REST 翻页。 */
export const MESSAGES_CAP = 200;

interface ChatStoreState {
  connected: boolean;
  connecting: boolean;
  currentUserId: string | null;
  conversations: ChatConversationDto[];
  messagesByConversation: Record<string, ChatMessageDto[]>;
  activeConversationId: string | null;

  setConnected: (connected: boolean) => void;
  setConnecting: (connecting: boolean) => void;
  setCurrentUserId: (userId: string | null) => void;
  setConversations: (conversations: ChatConversationDto[]) => void;
  setActiveConversationId: (conversationId: string | null) => void;
  /**
   * 消息入库（历史页 / 广播 / 本地乐观消息共用）：
   * 按 d 对账替换乐观消息 → 按 id 去重 → height 升序（乐观消息 height=0 按
   * createdAt 排尾）→ 截断到 MESSAGES_CAP（保最新）。
   * 未涉及的会话保持原数组引用（聊天页依赖引用稳定避免全量重渲染）。
   */
  ingestMessages: (conversationId: string, incoming: ChatMessageDto[]) => void;
  /** 成员已读推进（服务端广播）；对端已读用于单聊「已读」标记。 */
  applyRead: (conversationId: string, userId: string, height: number) => void;
  readWatermarks: Record<string, Record<string, number>>;
  reset: () => void;
}

function sortKey(message: ChatMessageDto): number {
  // height=0 的本地乐观消息永远排在已确认消息之后，内部按发送时间稳定排序。
  if (message.height > 0) return message.height;
  return Number.MAX_SAFE_INTEGER / 2 + Date.parse(message.createdAt);
}

export function mergeMessages(
  existing: ChatMessageDto[],
  incoming: ChatMessageDto[],
): ChatMessageDto[] {
  const byId = new Map<string, ChatMessageDto>();
  const byDelivery = new Map<string, string>();
  for (const message of existing) {
    byId.set(message.id, message);
    if (message.d) byDelivery.set(message.d, message.id);
  }
  for (const message of incoming) {
    // 服务端回执/广播带同一 d：替换掉本地乐观占位（id 不同但 d 相同）。
    if (message.d) {
      const priorId = byDelivery.get(message.d);
      if (priorId !== undefined && priorId !== message.id) {
        byId.delete(priorId);
      }
      byDelivery.set(message.d, message.id);
    }
    byId.set(message.id, message);
  }
  const merged = [...byId.values()].sort((a, b) => sortKey(a) - sortKey(b));
  return merged.length > MESSAGES_CAP ? merged.slice(merged.length - MESSAGES_CAP) : merged;
}

export const useChatStore = create<ChatStoreState>((set, get) => ({
  connected: false,
  connecting: false,
  currentUserId: null,
  conversations: [],
  messagesByConversation: {},
  activeConversationId: null,
  readWatermarks: {},

  setConnected: (connected) => set({ connected }),
  setConnecting: (connecting) => set({ connecting }),
  setCurrentUserId: (userId) => set({ currentUserId: userId }),
  setConversations: (conversations) => set({ conversations }),
  setActiveConversationId: (conversationId) =>
    set({ activeConversationId: conversationId }),

  ingestMessages: (conversationId, incoming) => {
    if (incoming.length === 0) return;
    const { messagesByConversation } = get();
    const existing = messagesByConversation[conversationId] ?? [];
    const merged = mergeMessages(existing, incoming);
    set({
      // 只替换本会话的键：其它会话数组引用保持不变（引用稳定契约）。
      messagesByConversation: {
        ...messagesByConversation,
        [conversationId]: merged,
      },
    });
  },

  applyRead: (conversationId, userId, height) => {
    const { readWatermarks } = get();
    const conversation = readWatermarks[conversationId] ?? {};
    const prior = conversation[userId] ?? 0;
    if (height <= prior) return;
    set({
      readWatermarks: {
        ...readWatermarks,
        [conversationId]: { ...conversation, [userId]: height },
      },
    });
  },

  reset: () =>
    set({
      connected: false,
      connecting: false,
      currentUserId: null,
      conversations: [],
      messagesByConversation: {},
      activeConversationId: null,
      readWatermarks: {},
    }),
}));
