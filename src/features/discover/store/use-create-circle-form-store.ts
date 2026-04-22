import { create } from 'zustand';

interface CreateCircleFormState {
  selectedCities: string[];
  setSelectedCities: (cities: string[]) => void;
  reset: () => void;
}

export const useCreateCircleFormStore = create<CreateCircleFormState>(
  (set) => ({
    selectedCities: [],

    setSelectedCities: (cities) => set({ selectedCities: cities }),

    reset: () => set({ selectedCities: [] }),
  }),
);
