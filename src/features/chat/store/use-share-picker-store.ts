import type { FriendProfile } from '@/services/api/friends';
import type { NoteSummary } from '@/features/notes/types';
import type { NoteSendOptions } from '@/features/chat/utils/note-batch-send';
import type { UserCollection } from '@/services/api/collections';
import { create } from 'zustand';

/**
 * SharePickerScreen 选完后写入这里；ChatDetailScreen 重新拿到焦点时
 * `consume()` 一次性取走并清空，触发对应消息发送。
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
  pending: SharePickedItem | null;
  setPending: (item: SharePickedItem) => void;
  consume: () => SharePickedItem | null;
}

export const useSharePickerStore = create<SharePickerState>((set, get) => ({
  pending: null,
  setPending: (item) => set({ pending: item }),
  consume: () => {
    const item = get().pending;
    if (item) set({ pending: null });
    return item;
  },
}));
