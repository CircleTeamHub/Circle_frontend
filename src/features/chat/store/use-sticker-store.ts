import { create } from 'zustand';
import { useAuthStore } from '@/stores/authStore';
import { createSticker, fetchStickers, removeSticker, type CustomSticker, type StickerSource } from '@/services/api/stickers';

interface StickerState {
  items: CustomSticker[];
  loading: boolean;
  error: boolean;
  refresh: () => Promise<void>;
  save: (source: StickerSource) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

// Private signed URLs stay in memory only. The server owns the collection.
let revision = 0;
export const useStickerStore = create<StickerState>((set, get) => ({
  items: [], loading: false, error: false,
  refresh: async () => {
    if (get().loading) return;
    const epoch = useAuthStore.getState().sessionEpoch;
    const startedAt = revision;
    set({ loading: true, error: false });
    try {
      const items = await fetchStickers();
      if (useAuthStore.getState().sessionEpoch === epoch && revision === startedAt) set({ items });
    } catch {
      if (useAuthStore.getState().sessionEpoch === epoch) set({ error: true });
    } finally {
      if (useAuthStore.getState().sessionEpoch === epoch) set({ loading: false });
    }
  },
  save: async (source) => {
    const epoch = useAuthStore.getState().sessionEpoch;
    const item = await createSticker(source);
    if (useAuthStore.getState().sessionEpoch !== epoch) return;
    revision++;
    set((state) => ({ items: [...state.items.filter((row) => row.id !== item.id), item] }));
  },
  remove: async (id) => {
    const epoch = useAuthStore.getState().sessionEpoch;
    await removeSticker(id);
    if (useAuthStore.getState().sessionEpoch !== epoch) return;
    revision++;
    set((state) => ({ items: state.items.filter((item) => item.id !== id) }));
  },
}));

useAuthStore.subscribe((state, previous) => {
  if (state.sessionEpoch === previous.sessionEpoch) return;
  revision++;
  useStickerStore.setState({ items: [], loading: false, error: false });
});
