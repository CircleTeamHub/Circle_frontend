import { create } from 'zustand';

interface PostFormState {
  selectedCircle: { id: string; name: string } | null;
  selectedCity: string | null;
  selectedNote: { id: string; title: string } | null;

  setSelectedCircle: (circle: { id: string; name: string } | null) => void;
  setSelectedCity: (city: string | null) => void;
  setSelectedNote: (note: { id: string; title: string } | null) => void;
  reset: () => void;
}

export const usePostFormStore = create<PostFormState>((set) => ({
  selectedCircle: null,
  selectedCity: null,
  selectedNote: null,

  setSelectedCircle: (circle) => set({ selectedCircle: circle }),
  setSelectedCity: (city) => set({ selectedCity: city }),
  setSelectedNote: (note) => set({ selectedNote: note }),
  reset: () =>
    set({ selectedCircle: null, selectedCity: null, selectedNote: null }),
}));
