import { create } from 'zustand';

type WalletRealtimeState = {
  balance: number | null;
  version: number;
  setRealtimeBalance: (balance: number) => void;
  setRealtimeBalanceIfVersion: (
    expectedVersion: number,
    balance: number,
  ) => boolean;
  reset: () => void;
};

const initialState = {
  balance: null,
  version: 0,
};

export const useWalletRealtimeStore = create<WalletRealtimeState>((set) => ({
  ...initialState,
  setRealtimeBalance: (balance) =>
    set((state) => {
      // 防守：NaN / Infinity / 负数都视作无效输入，保留上一次状态。
      // 实时通道偶发的脏 payload 不应该污染钱包余额。
      if (!Number.isFinite(balance) || balance < 0) {
        return state;
      }
      return {
        balance,
        version: state.version + 1,
      };
    }),
  setRealtimeBalanceIfVersion: (expectedVersion, balance) => {
    let applied = false;
    set((state) => {
      if (
        state.version !== expectedVersion ||
        !Number.isFinite(balance) ||
        balance < 0
      ) {
        return state;
      }
      applied = true;
      return {
        balance,
        version: state.version + 1,
      };
    });
    return applied;
  },
  reset: () => set(initialState),
}));
