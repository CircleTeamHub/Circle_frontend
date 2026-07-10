import { create } from 'zustand';
import type { PlazaPostCardData } from '@/types';

/**
 * 「打开会话时预挂一张待发送卡片 + 预填草稿」的一次性传值。
 *
 * 报名管理点开报名者聊天时写入这里；ChatDetailScreen 获焦后按 conversationKey
 * `consumeFor` 一次性取走（避免挂到别的会话），把卡片显示为输入框上方的待发引用、
 * 并预填开场白。用户可撤掉卡片 / 编辑 / 清空文字，点发送时先发卡片后发文字。
 *
 * 不持久化 —— 跨屏一次性传值，关 app 就丢，没问题。
 */
export interface PendingChatCard {
  // 目标单聊的 sourceID（UUID 形式），保证卡片只挂到对的会话。
  conversationKey: string;
  card: PlazaPostCardData;
  draftText: string;
}

interface PendingChatCardState {
  pending: PendingChatCard | null;
  setPending: (item: PendingChatCard) => void;
  consumeFor: (conversationKey: string) => PendingChatCard | null;
  clear: () => void;
}

export const usePendingChatCardStore = create<PendingChatCardState>(
  (set, get) => ({
    pending: null,
    setPending: (item) => set({ pending: item }),
    consumeFor: (conversationKey) => {
      const item = get().pending;
      if (item && item.conversationKey === conversationKey) {
        set({ pending: null });
        return item;
      }
      return null;
    },
    clear: () => set({ pending: null }),
  }),
);
