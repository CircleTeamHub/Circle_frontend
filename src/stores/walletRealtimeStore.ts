import { create } from 'zustand';

type WalletRealtimeState = {
  balance: number | null;
  version: number;
  setRealtimeBalance: (balance: number) => void;
  reset: () => void;
};

const initialState = {
  balance: null,
  version: 0,
};

export const useWalletRealtimeStore = create<WalletRealtimeState>((set) => ({
  ...initialState,
  setRealtimeBalance: (balance) =>
    set((state) => ({
      balance,
      version: state.version + 1,
    })),
  reset: () => set(initialState),
}));
