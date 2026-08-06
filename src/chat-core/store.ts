import { create } from 'zustand';
import type { ChatConversationDto, ChatMessageDto } from './protocol';

/** 每会话内存消息上限（与旧 imStore 一致）：更早的历史走 REST 翻页。 */
export const MESSAGES_CAP = 200;

/**
 * store 里的消息 = 线上 DTO + 客户端本地态:
 * failed 只在乐观消息(height=0)发送失败时置位,永不上行。
 */
export type StoredChatMessage = ChatMessageDto & { failed?: boolean };

interface ChatStoreState {
  connected: boolean;
  connecting: boolean;
  /** 最近一次连接失败的原因文案(消息页空态提示用)。 */
  error: string | null;
  currentUserId: string | null;
  conversations: ChatConversationDto[];
  messagesByConversation: Record<string, ChatMessageDto[]>;
  activeConversationId: string | null;

  setConnected: (connected: boolean) => void;
  setConnecting: (connecting: boolean) => void;
  setError: (error: string | null) => void;
  setCurrentUserId: (userId: string | null) => void;
  setConversations: (conversations: ChatConversationDto[]) => void;
  /** 单会话回写(偏好变更/新建后),保持排序不变量。 */
  upsertConversation: (conversation: ChatConversationDto) => void;
  removeConversation: (conversationId: string) => void;
  /**
   * 新消息驱动会话列表:末条预览/时间前移、他人消息未读 +1、重排序。
   * 列表里没有的会话(如刚被建的单聊)由消息页 focus 重拉兜底。
   */
  applyIncomingMessage: (message: ChatMessageDto) => void;
  /** 本端已读的乐观归零(socket 上报之外的即时 UI 反馈)。 */
  markConversationReadLocal: (conversationId: string) => void;
  /** 乐观消息发送失败:按 d 标记,气泡转失败态。 */
  markMessageFailed: (conversationId: string, d: string) => void;
  /** 本地删除一条消息(仅本端视图;服务端删除随后续批次)。 */
  removeMessage: (conversationId: string, messageId: string) => void;
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

/** 会话排序不变量:置顶在前 → lastMessageAt 降序 → id 兜底稳定。 */
export function sortConversations(
  conversations: ChatConversationDto[],
): ChatConversationDto[] {
  return [...conversations].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const ta = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0;
    const tb = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0;
    if (ta !== tb) return tb - ta;
    if (a.id === b.id) return 0;
    return a.id < b.id ? -1 : 1;
  });
}

export const useChatStore = create<ChatStoreState>((set, get) => ({
  connected: false,
  connecting: false,
  error: null,
  currentUserId: null,
  conversations: [],
  messagesByConversation: {},
  activeConversationId: null,
  readWatermarks: {},

  setConnected: (connected) => set({ connected }),
  setConnecting: (connecting) => set({ connecting }),
  setError: (error) => set({ error }),
  setCurrentUserId: (userId) => set({ currentUserId: userId }),
  setConversations: (conversations) =>
    set({ conversations: sortConversations(conversations) }),
  upsertConversation: (conversation) => {
    const { conversations } = get();
    const rest = conversations.filter((c) => c.id !== conversation.id);
    set({ conversations: sortConversations([...rest, conversation]) });
  },
  removeConversation: (conversationId) =>
    set({
      conversations: get().conversations.filter((c) => c.id !== conversationId),
    }),
  applyIncomingMessage: (message) => {
    const { conversations, currentUserId, activeConversationId } = get();
    const index = conversations.findIndex((c) => c.id === message.conversationId);
    if (index < 0) return;
    const target = conversations[index];
    const fromSelf =
      currentUserId !== null && message.sender?.id === currentUserId;
    // 正在看的会话不累计未读(进入会话即视为已读,读水位由屏幕上报)。
    const countsUnread =
      !fromSelf && activeConversationId !== message.conversationId;
    const next: ChatConversationDto = {
      ...target,
      lastMessage: message,
      lastMessageAt: message.createdAt,
      unreadCount: countsUnread ? target.unreadCount + 1 : target.unreadCount,
    };
    set({
      conversations: sortConversations([
        ...conversations.slice(0, index),
        next,
        ...conversations.slice(index + 1),
      ]),
    });
  },
  markMessageFailed: (conversationId, d) => {
    const { messagesByConversation } = get();
    const existing = messagesByConversation[conversationId] ?? [];
    const index = existing.findIndex(
      (m) => m.d === d && m.height === 0 && !(m as StoredChatMessage).failed,
    );
    if (index < 0) return;
    const next: StoredChatMessage = { ...existing[index], failed: true };
    set({
      messagesByConversation: {
        ...messagesByConversation,
        [conversationId]: [
          ...existing.slice(0, index),
          next,
          ...existing.slice(index + 1),
        ],
      },
    });
  },

  removeMessage: (conversationId, messageId) => {
    const { messagesByConversation } = get();
    const existing = messagesByConversation[conversationId] ?? [];
    const filtered = existing.filter((m) => m.id !== messageId);
    if (filtered.length === existing.length) return;
    set({
      messagesByConversation: {
        ...messagesByConversation,
        [conversationId]: filtered,
      },
    });
  },

  markConversationReadLocal: (conversationId) => {
    const { conversations } = get();
    const index = conversations.findIndex((c) => c.id === conversationId);
    if (index < 0 || conversations[index].unreadCount === 0) return;
    const next = { ...conversations[index], unreadCount: 0 };
    set({
      conversations: [
        ...conversations.slice(0, index),
        next,
        ...conversations.slice(index + 1),
      ],
    });
  },
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
      error: null,
      currentUserId: null,
      conversations: [],
      messagesByConversation: {},
      activeConversationId: null,
      readWatermarks: {},
    }),
}));

/** 消息 tab 角标 = 非免打扰会话的未读合计(免打扰只显红点由 UI 层处理)。 */
export function selectTotalUnread(state: {
  conversations: ChatConversationDto[];
}): number {
  return state.conversations.reduce(
    (sum, c) => (c.muted ? sum : sum + c.unreadCount),
    0,
  );
}
