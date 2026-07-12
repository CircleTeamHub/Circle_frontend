import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { mmkvJsonStorage } from '@/storage';

interface CircleShortcutOrderState {
  orderIds: string[];
  setOrderIds: (ids: string[]) => void;
  resetOrder: () => void;
}

export const useCircleShortcutOrderStore =
  create<CircleShortcutOrderState>()(
    persist(
      (set) => ({
        orderIds: [],
        setOrderIds: (ids) => set({ orderIds: ids }),
        resetOrder: () => set({ orderIds: [] }),
      }),
      {
        name: 'circle-im-circle-shortcut-order',
        storage: createJSONStorage(() => mmkvJsonStorage),
      },
    ),
  );
