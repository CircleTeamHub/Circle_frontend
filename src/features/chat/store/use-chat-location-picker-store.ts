import { create } from 'zustand';
import type { PickedLocation } from '@/features/location/types';

/**
 * 选点结果必须绑定「是从哪个会话点开的」。
 *
 * 这个 store 是全局的，而 ChatDetailScreen 一获得焦点就会消费它并**直接把位置
 * 发出去**。不绑会话的话，任何拿到选点页的路径（深链直接进 /location-picker、
 * 或者确认之后先被推送带去了另一个会话）都会让这条位置发给非预期的收件人。
 * 所以：只有 conversationID 完全一致的会话才能消费；对不上的结果直接丢弃，
 * 不留在 store 里等下一个会话。
 */
type PendingPickedLocation = {
  conversationID: string | null;
  location: PickedLocation;
};

type ChatLocationPickerState = {
  pending: PendingPickedLocation | null;
  setPickedLocation: (
    location: PickedLocation,
    conversationID: string | null,
  ) => void;
  clearPickedLocation: () => void;
  consumePickedLocation: (conversationID: string) => PickedLocation | null;
};

export const useChatLocationPickerStore = create<ChatLocationPickerState>(
  (set, get) => ({
    pending: null,
    setPickedLocation: (location, conversationID) =>
      set({ pending: { conversationID, location } }),
    clearPickedLocation: () => set({ pending: null }),
    consumePickedLocation: (conversationID) => {
      const pending = get().pending;
      if (!pending) return null;
      // 无论对不对得上都清掉：孤儿结果留在 store 里就是下一个会话的隐患。
      set({ pending: null });
      if (pending.conversationID !== conversationID) return null;
      return pending.location;
    },
  }),
);
