import { create } from 'zustand';

interface PostFormState {
  selectedCircle: { id: string; name: string } | null;
  selectedCity: string | null;

  setSelectedCircle: (circle: { id: string; name: string } | null) => void;
  setSelectedCity: (city: string | null) => void;
  reset: () => void;
}

export const usePostFormStore = create<PostFormState>((set) => ({
  selectedCircle: null,
  selectedCity: null,

  setSelectedCircle: (circle) => set({ selectedCircle: circle }),
  setSelectedCity: (city) => set({ selectedCity: city }),
  reset: () => set({ selectedCircle: null, selectedCity: null }),
}));
