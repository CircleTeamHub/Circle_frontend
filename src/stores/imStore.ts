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
  reset: () => void;
}

// 将 SDK 推送的会话变更合并到现有列表（以 conversationID 去重），并按最新消息时间降序排列
function mergeConversationList(
  current: ConversationItem[],
  updates: ConversationItem[]
) {
  const next = new Map(current.map((item) => [item.conversationID, item]));

  for (const item of updates) {
    next.set(item.conversationID, item);
  }

  return [...next.values()].sort(
    (left, right) => right.latestMsgSendTime - left.latestMsgSendTime
  );
}

// 将新消息合并到现有消息列表（以 clientMsgID 去重），并按发送时间升序排列（最旧在上）
function mergeMessageList(current: MessageItem[], updates: MessageItem[]) {
  const next = new Map(current.map((item) => [item.clientMsgID, item]));

  for (const item of updates) {
    next.set(item.clientMsgID, item);
  }

  return [...next.values()].sort((left, right) => left.sendTime - right.sendTime);
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
      conversations: [...conversations].sort(
        (left, right) => right.latestMsgSendTime - left.latestMsgSendTime
      ),
    }),
  mergeConversations: (conversations) =>
    set((state) => ({
      conversations: mergeConversationList(state.conversations, conversations),
    })),
  setTotalUnread: (totalUnread) => set({ totalUnread }),
  setActiveConversation: (activeConversation) => set({ activeConversation }),
  setMessages: (conversationID, messages) =>
    set((state) => ({
      messagesByConversation: {
        ...state.messagesByConversation,
        [conversationID]: [...messages].sort((left, right) => left.sendTime - right.sendTime),
      },
    })),
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
  reset: () => set(initialState),
}));
