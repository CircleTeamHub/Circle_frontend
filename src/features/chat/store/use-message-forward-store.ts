import { create } from 'zustand';
import type { MessageItem } from '@openim/rn-client-sdk';
import type { ChatMessage } from '@/types';

type PendingForward = {
  message: ChatMessage;
  // Raw OpenIM payload when available, so forwarding can use the native
  // createForwardMessage primitive (preserves images / media). Optimistic or
  // collected messages may lack it; the picker falls back to reconstruction.
  raw?: MessageItem;
};

interface MessageForwardState {
  pending: PendingForward | null;
  setPending: (item: PendingForward) => void;
  clear: () => void;
}

export const useMessageForwardStore = create<MessageForwardState>((set) => ({
  pending: null,
  setPending: (item) => set({ pending: item }),
  clear: () => set({ pending: null }),
}));
