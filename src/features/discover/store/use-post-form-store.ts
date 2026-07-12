import { create } from 'zustand';

export interface PostFormCircle {
  id: string;
  name: string;
}

interface PostFormState {
  // 发帖：圈子 + 城市均为多选；笔记仍单选。
  selectedCircles: PostFormCircle[];
  selectedCities: string[];
  selectedNote: { id: string; title: string } | null;

  setSelectedCircles: (circles: PostFormCircle[]) => void;
  toggleCircle: (circle: PostFormCircle) => void;
  setSelectedCities: (cities: string[]) => void;
  setSelectedNote: (note: { id: string; title: string } | null) => void;
  reset: () => void;
}

export const usePostFormStore = create<PostFormState>((set) => ({
  selectedCircles: [],
  selectedCities: [],
  selectedNote: null,

  setSelectedCircles: (circles) => set({ selectedCircles: circles }),
  toggleCircle: (circle) =>
    set((state) => {
      const exists = state.selectedCircles.some((c) => c.id === circle.id);
      return {
        selectedCircles: exists
          ? state.selectedCircles.filter((c) => c.id !== circle.id)
          : [...state.selectedCircles, circle],
      };
    }),
  setSelectedCities: (cities) => set({ selectedCities: cities }),
  setSelectedNote: (note) => set({ selectedNote: note }),
  reset: () =>
    set({ selectedCircles: [], selectedCities: [], selectedNote: null }),
}));
