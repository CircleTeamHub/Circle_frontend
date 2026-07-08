/**
 * imStore.ts — OpenIM 运行时状态（不持久化）
 *
 * 存储：
 * - SDK 连接状态（initialized / connecting / connected / error）
 * - 当前登录的 IM 用户 ID
 * - 会话列表（按最新消息时间降序）
 * - 全局未读数
 * - 当前打开的会话（供 listeners 过滤新消息）
 * - 各会话的消息列表（按发送时间升序）
 *
 * 该 store 不使用 persist，所有状态在 app 重启后从 SDK 重新拉取。
 */
import { create } from 'zustand';
import { OnlineState } from '@openim/rn-client-sdk';
import type { ConversationItem, MessageItem, SessionType } from '@openim/rn-client-sdk';

// 当前打开的会话标识，供 listeners 判断新消息是否属于当前页面
export type ActiveConversation = {
  conversationID: string;
  sourceID: string;
  sessionType: SessionType;
};

interface IMState {
  currentUserID: string | null;
  initialized: boolean;
  connecting: boolean;
  connected: boolean;
  error: string | null;
  conversations: ConversationItem[];
  totalUnread: number;
  activeConversation: ActiveConversation | null;
  messagesByConversation: Record<string, MessageItem[]>;
  // 在线状态按 IM 用户 ID 索引（去连字符的形式，与 OpenIM 推送一致）
  onlineStatusByUser: Record<string, OnlineState>;

  setCurrentUserID: (userID: string | null) => void;
  setInitialized: (initialized: boolean) => void;
  setConnecting: (connecting: boolean) => void;
  setConnected: (connected: boolean) => void;
  setError: (error: string | null) => void;
  setConversations: (conversations: ConversationItem[]) => void;
  mergeConversations: (conversations: ConversationItem[]) => void;
  setTotalUnread: (totalUnread: number) => void;
  setActiveConversation: (conversation: ActiveConversation | null) => void;
  setMessages: (conversationID: string, messages: MessageItem[]) => void;
  appendMessages: (conversationID: string, messages: MessageItem[]) => void;
  /** 收到对方读回执时把对应 clientMsgID 列表标记为 isRead=true。 */
  markMessagesRead: (conversationID: string, clientMsgIDs: string[]) => void;
  /** 乐观发送失败时把对应 clientMsgID 的消息标记为失败态 status=3。 */
  markMessageSendFailed: (conversationID: string, clientMsgID: string) => void;
  /** 批量更新某些用户的在线状态（订阅返回值或 onUserStatusChanged 都走这里）。 */
  setUserOnlineStatuses: (
    statuses: readonly { userID: string; status: OnlineState }[],
  ) => void;
  clearAllMessages: () => void;
  reset: () => void;
}

// 会话列表排序：置顶在上（按最新消息时间降序），未置顶在下（按最新消息时间降序）。
// 同时间戳（群创建瞬间多条事件、初次拉取时无 latestMsgSendTime 等）下用
// conversationID 做 tiebreaker，避免依赖 Array.sort 输入顺序产生抖动。
function compareConversations(left: ConversationItem, right: ConversationItem) {
  const leftPinned = left.isPinned === true;
  const rightPinned = right.isPinned === true;
  if (leftPinned !== rightPinned) {
    return leftPinned ? -1 : 1;
  }
  const timeDelta = right.latestMsgSendTime - left.latestMsgSendTime;
  if (timeDelta !== 0) return timeDelta;
  return left.conversationID < right.conversationID ? -1 : left.conversationID > right.conversationID ? 1 : 0;
}

// 将 SDK 推送的会话变更合并到现有列表（以 conversationID 去重）并排序
function mergeConversationList(
  current: ConversationItem[],
  updates: ConversationItem[]
) {
  const next = new Map(current.map((item) => [item.conversationID, item]));

  for (const item of updates) {
    next.set(item.conversationID, item);
  }

  return [...next.values()].sort(compareConversations);
}

// 内存中每个会话最多保留的消息条数
const MAX_MESSAGES_PER_CONVERSATION = 200;

// 将新消息合并到现有消息列表（以 clientMsgID 去重），并按发送时间升序排列（最旧在上）
// 合并后截取最新的 MAX_MESSAGES_PER_CONVERSATION 条，防止长会话占用过多内存
function mergeMessageList(current: MessageItem[], updates: MessageItem[]) {
  const next = new Map(current.map((item) => [item.clientMsgID, item]));

  for (const item of updates) {
    next.set(item.clientMsgID, item);
  }

  const sorted = [...next.values()].sort((left, right) => left.sendTime - right.sendTime);
  return sorted.length > MAX_MESSAGES_PER_CONVERSATION
    ? sorted.slice(-MAX_MESSAGES_PER_CONVERSATION)
    : sorted;
}

const initialState = {
  currentUserID: null,
  initialized: false,
  connecting: false,
  connected: false,
  error: null,
  conversations: [],
  totalUnread: 0,
  activeConversation: null,
  messagesByConversation: {},
  onlineStatusByUser: {},
};

export const useIMStore = create<IMState>((set) => ({
  ...initialState,

  setCurrentUserID: (currentUserID) => set({ currentUserID }),
  setInitialized: (initialized) => set({ initialized }),
  setConnecting: (connecting) => set({ connecting }),
  setConnected: (connected) => set({ connected }),
  setError: (error) => set({ error }),
  setConversations: (conversations) =>
    set({
      conversations: [...conversations].sort(compareConversations),
    }),
  mergeConversations: (conversations) =>
    set((state) => ({
      conversations: mergeConversationList(state.conversations, conversations),
    })),
  setTotalUnread: (totalUnread) => set({ totalUnread }),
  setActiveConversation: (activeConversation) => set({ activeConversation }),
  setMessages: (conversationID, messages) =>
    set((state) => {
      const sorted = [...messages].sort((left, right) => left.sendTime - right.sendTime);
      const capped = sorted.length > MAX_MESSAGES_PER_CONVERSATION
        ? sorted.slice(-MAX_MESSAGES_PER_CONVERSATION)
        : sorted;
      return {
        messagesByConversation: {
          ...state.messagesByConversation,
          [conversationID]: capped,
        },
      };
    }),
  appendMessages: (conversationID, messages) =>
    set((state) => ({
      messagesByConversation: {
        ...state.messagesByConversation,
        [conversationID]: mergeMessageList(
          state.messagesByConversation[conversationID] ?? [],
          messages
        ),
      },
    })),
  markMessagesRead: (conversationID, clientMsgIDs) =>
    set((state) => {
      const list = state.messagesByConversation[conversationID];
      if (!list || list.length === 0 || clientMsgIDs.length === 0) {
        return state;
      }
      const idSet = new Set(clientMsgIDs);
      let changed = false;
      const next = list.map((msg) => {
        if (idSet.has(msg.clientMsgID) && !msg.isRead) {
          changed = true;
          return { ...msg, isRead: true };
        }
        return msg;
      });
      if (!changed) return state;
      return {
        messagesByConversation: {
          ...state.messagesByConversation,
          [conversationID]: next,
        },
      };
    }),
  markMessageSendFailed: (conversationID, clientMsgID) =>
    set((state) => {
      const list = state.messagesByConversation[conversationID];
      if (!list || list.length === 0) return state;
      let changed = false;
      const next = list.map((msg) => {
        if (msg.clientMsgID === clientMsgID && msg.status !== 3) {
          changed = true;
          return { ...msg, status: 3 as MessageItem['status'] };
        }
        return msg;
      });
      if (!changed) return state;
      return {
        messagesByConversation: {
          ...state.messagesByConversation,
          [conversationID]: next,
        },
      };
    }),
  setUserOnlineStatuses: (statuses) =>
    set((state) => {
      if (statuses.length === 0) return state;
      const next = { ...state.onlineStatusByUser };
      for (const item of statuses) {
        if (!item.userID) continue;
        next[item.userID] = item.status;
      }
      return { onlineStatusByUser: next };
    }),
  clearAllMessages: () => set({ messagesByConversation: {}, totalUnread: 0 }),
  reset: () => set(initialState),
}));
