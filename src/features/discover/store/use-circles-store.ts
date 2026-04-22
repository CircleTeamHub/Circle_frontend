import { create } from 'zustand';
import { fetchCircles, fetchMyCircles } from '@/services/api/circles';
import { getApiErrorMessage } from '@/services/api/errors';
import type { Circle } from '@/types';

interface CirclesState {
  joinedCircles: Circle[];
  createdCircles: Circle[];
  appliedCircles: Circle[];
  allCircles: Circle[];
  myCirclesLoading: boolean;
  allCirclesLoading: boolean;
  myCirclesError: string | null;
  allCirclesError: string | null;

  fetchMyCircles: () => Promise<void>;
  fetchAllCircles: () => Promise<void>;
  reset: () => void;
}

export const useCirclesStore = create<CirclesState>((set) => ({
  joinedCircles: [],
  createdCircles: [],
  appliedCircles: [],
  allCircles: [],
  myCirclesLoading: false,
  allCirclesLoading: false,
  myCirclesError: null,
  allCirclesError: null,

  fetchMyCircles: async () => {
    set({ myCirclesLoading: true, myCirclesError: null });
    try {
      const [joined, created, applied] = await Promise.all([
        fetchMyCircles('joined'),
        fetchMyCircles('created'),
        fetchMyCircles('applied'),
      ]);
      set({
        joinedCircles: joined,
        createdCircles: created,
        appliedCircles: applied,
        myCirclesError: null,
      });
    } catch (error) {
      set({
        myCirclesError: getApiErrorMessage(
          error,
          '加载圈子列表失败，请稍后重试',
        ),
      });
    } finally {
      set({ myCirclesLoading: false });
    }
  },

  fetchAllCircles: async () => {
    set({ allCirclesLoading: true, allCirclesError: null });
    try {
      const result = await fetchCircles({ limit: 100 });
      set({ allCircles: result.items, allCirclesError: null });
    } catch (error) {
      set({
        allCirclesError: getApiErrorMessage(
          error,
          '加载圈子筛选失败，请稍后重试',
        ),
      });
    } finally {
      set({ allCirclesLoading: false });
    }
  },

  reset: () =>
    set({
      joinedCircles: [],
      createdCircles: [],
      appliedCircles: [],
      allCircles: [],
      myCirclesLoading: false,
      allCirclesLoading: false,
      myCirclesError: null,
      allCirclesError: null,
    }),
}));
