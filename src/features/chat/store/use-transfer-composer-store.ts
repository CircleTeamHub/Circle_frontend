import { create } from 'zustand';

/**
 * TransferComposer 转账成功后写入这里；ChatDetailScreen 重新拿到焦点时
 * `consume()` 取走并清空，触发对应 IM 卡片消息发送。
 */
export interface TransferPendingPayload {
  amount: number;
  message: string | null;
}

interface TransferComposerState {
  pending: TransferPendingPayload | null;
  setPending: (payload: TransferPendingPayload) => void;
  consume: () => TransferPendingPayload | null;
}

export const useTransferComposerStore = create<TransferComposerState>(
  (set, get) => ({
    pending: null,
    setPending: (payload) => set({ pending: payload }),
    consume: () => {
      const item = get().pending;
      if (item) set({ pending: null });
      return item;
    },
  }),
);
