import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { mmkvJsonStorage } from '@/storage';

interface DiscoverFilterState {
  appliedCircleIds: string[];
  appliedCities: string[];
  draftCircleIds: string[];
  draftCities: string[];

  loadDraftFromApplied: () => void;
  setDraftCircleIds: (ids: string[]) => void;
  setDraftCities: (cities: string[]) => void;
  removeDraftCircle: (id: string) => void;
  removeDraftCity: (city: string) => void;
  clearDraft: () => void;
  saveFilter: () => void;
}

export const useDiscoverFilterStore = create<DiscoverFilterState>()(
  persist(
    (set, get) => ({
      appliedCircleIds: [],
      appliedCities: [],
      draftCircleIds: [],
      draftCities: [],

      loadDraftFromApplied: () => {
        const { appliedCircleIds, appliedCities } = get();
        set({
          draftCircleIds: [...appliedCircleIds],
          draftCities: [...appliedCities],
        });
      },

      setDraftCircleIds: (ids) => set({ draftCircleIds: ids }),
      setDraftCities: (cities) => set({ draftCities: cities }),

      removeDraftCircle: (id) =>
        set((state) => ({
          draftCircleIds: state.draftCircleIds.filter((value) => value !== id),
        })),

      removeDraftCity: (city) =>
        set((state) => ({
          draftCities: state.draftCities.filter((value) => value !== city),
        })),

      clearDraft: () => set({ draftCircleIds: [], draftCities: [] }),

      saveFilter: () => {
        const { draftCircleIds, draftCities } = get();
        set({
          appliedCircleIds: [...draftCircleIds],
          appliedCities: [...draftCities],
        });
      },
    }),
    {
      name: 'circle-im-discover-filter',
      storage: createJSONStorage(() => mmkvJsonStorage),
      partialize: (state) => ({
        appliedCircleIds: state.appliedCircleIds,
        appliedCities: state.appliedCities,
      }),
    },
  ),
);
