import { create } from 'zustand';
import {
  fetchCircleDetail,
  fetchCircles,
  fetchMyCircles,
} from '@/services/api/circles';
import { getApiErrorMessage } from '@/services/api/errors';
import type { Circle } from '@/types';
import { deriveManagedCircles } from './managed-circles';

interface CirclesState {
  joinedCircles: Circle[];
  createdCircles: Circle[];
  managedCircles: Circle[];
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
  managedCircles: [],
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
      const createdCircleIds = new Set(created.map((circle) => circle.id));
      const joinedCandidates = joined.filter(
        (circle) => !createdCircleIds.has(circle.id),
      );
      const joinedCircleDetails = await Promise.allSettled(
        joinedCandidates.map((circle) => fetchCircleDetail(circle.id)),
      );
      const managedCircles = deriveManagedCircles({
        createdCircles: created,
        joinedCircles: joinedCandidates,
        joinedCircleDetails: joinedCircleDetails.flatMap((result) =>
          result.status === 'fulfilled' ? [result.value] : [],
        ),
      });

      set({
        joinedCircles: joined,
        createdCircles: created,
        managedCircles,
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
      managedCircles: [],
      appliedCircles: [],
      allCircles: [],
      myCirclesLoading: false,
      allCirclesLoading: false,
      myCirclesError: null,
      allCirclesError: null,
    }),
}));
