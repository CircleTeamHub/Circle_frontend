import type { FriendProfile } from '@/services/api/friends';
import type { NoteSummary } from '@/features/notes/types';
import type { NoteSendOptions } from '@/features/chat/utils/note-batch-send';
import type { UserCollection } from '@/services/api/collections';
import { create } from 'zustand';

/**
 * SharePickerScreen 选完后写入这里；ChatDetailScreen 重新拿到焦点时
 * `consumeFor(sourceID)` 一次性取走并清空，触发对应消息发送。
 * 按打开选择页的那个聊天(sourceID)认领:别的聊天页先拿到焦点时把它丢掉,
 * 不让私人笔记/名片发进别的会话,也不留到以后再冒出来。
 *
 * 不持久化 —— 跨屏一次性传值，关 app 就丢，没问题。
 */
/** 群名片的发送对象:独立群聊(圈子群走圈子名片)。令牌由聊天页发送时现签。 */
export interface GroupCardTarget {
  conversationId: string;
  name: string;
  avatarUrl: string | null;
}

export type SharePickedItem =
  | { kind: 'note-batch'; notes: NoteSummary[]; options: NoteSendOptions }
  | { kind: 'friend'; data: FriendProfile }
  | { kind: 'group-card'; data: GroupCardTarget }
  | { kind: 'favorite'; data: UserCollection; message?: string }
  | { kind: 'quick-reply'; data: string };

interface SharePickerState {
  pending: { sourceID: string; item: SharePickedItem } | null;
  setPending: (sourceID: string, item: SharePickedItem) => void;
  consumeFor: (sourceID: string) => SharePickedItem | null;
}

export const useSharePickerStore = create<SharePickerState>((set, get) => ({
  pending: null,
  setPending: (sourceID, item) => set({ pending: { sourceID, item } }),
  consumeFor: (sourceID) => {
    const pending = get().pending;
    if (!pending) return null;
    set({ pending: null });
    return pending.sourceID === sourceID ? pending.item : null;
  },
}));
